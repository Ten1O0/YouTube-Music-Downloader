"""
Registro de uso: download_events.

`download_history` solo recoge descargas de usuarios autenticados, que son una
minoría, así que no servía para responder a "¿tiene esto uso real?". Esta tabla
registra TODAS las descargas, con sesión o sin ella.

Invariante que más importa: **el registro nunca debe romper una descarga**.
Es analítica; si falla, falla en silencio.
"""

import sqlite3

import pytest


# ========================================
# Registro básico
# ========================================

def test_logs_an_anonymous_download(db):
    assert db.log_download_started("a" * 32, video_id="abc", title="Canción") is True
    eventos = db.get_recent_downloads()
    assert len(eventos) == 1
    assert eventos[0]["title"] == "Canción"
    assert eventos[0]["user_id"] is None
    assert eventos[0]["status"] == "started"


def test_logs_an_authenticated_download(db, user):
    db.log_download_started("b" * 32, title="Con sesión", user_id=user["id"])
    assert db.get_recent_downloads()[0]["user_id"] == user["id"]


def test_records_content_type_and_total(db):
    db.log_download_started("c" * 32, content_type="playlist", total_items=25)
    evento = db.get_recent_downloads()[0]
    assert evento["content_type"] == "playlist"
    assert evento["total_items"] == 25


def test_missing_fields_get_defaults(db):
    db.log_download_started("d" * 32)
    evento = db.get_recent_downloads()[0]
    assert evento["video_id"] == ""
    assert evento["title"] == ""
    assert evento["total_items"] == 1


def test_recent_downloads_are_newest_first(db):
    for i in range(5):
        db.log_download_started(f"{i}" * 32, title=f"T{i}")
    titulos = [e["title"] for e in db.get_recent_downloads()]
    assert titulos[0] == "T4"


def test_recent_downloads_respects_limit(db):
    for i in range(10):
        db.log_download_started(f"{i:032d}", title=f"T{i}")
    assert len(db.get_recent_downloads(limit=3)) == 3


def test_unicode_titles_survive(db):
    db.log_download_started("e" * 32, title="Cançó 日本語 🎵")
    assert db.get_recent_downloads()[0]["title"] == "Cançó 日本語 🎵"


# ========================================
# Cierre del evento
# ========================================

def test_completes_an_event(db):
    did = "f" * 32
    db.log_download_started(did, title="X")
    assert db.complete_download_event(did, status="complete") is True

    evento = db.get_recent_downloads()[0]
    assert evento["status"] == "complete"
    assert evento["completed_at"] is not None


def test_completes_with_error(db):
    did = "a" * 32
    db.log_download_started(did)
    db.complete_download_event(did, status="error")
    assert db.get_recent_downloads()[0]["status"] == "error"


def test_completion_fills_missing_title(db):
    """En una búsqueda no se sabe el título hasta que yt-dlp resuelve el vídeo."""
    did = "b" * 32
    db.log_download_started(did, title="")
    db.complete_download_event(did, status="complete", title="Resuelto al final")
    assert db.get_recent_downloads()[0]["title"] == "Resuelto al final"


def test_completion_does_not_overwrite_an_existing_title(db):
    did = "c" * 32
    db.log_download_started(did, title="Conocido de antes")
    db.complete_download_event(did, status="complete", title="Otro")
    assert db.get_recent_downloads()[0]["title"] == "Conocido de antes"


def test_completing_unknown_id_is_harmless(db):
    assert db.complete_download_event("9" * 32, status="complete") is True


# ========================================
# La analítica NUNCA debe romper una descarga
# ========================================

def test_logging_failure_does_not_raise(db, monkeypatch):
    def explota(*a, **k):
        raise sqlite3.OperationalError("disco lleno")

    monkeypatch.setattr(db, "get_db", explota)
    assert db.log_download_started("a" * 32) is False       # no lanza
    assert db.complete_download_event("a" * 32) is False    # no lanza


# ========================================
# Estadísticas de uso
# ========================================

def test_stats_on_empty_database(db):
    stats = db.get_download_stats()
    assert stats["total"] == 0
    assert stats["anonimas"] == 0
    assert stats["mas_descargadas"] == []


def test_stats_count_anonymous_and_authenticated(db, user):
    for i in range(3):
        db.log_download_started(f"{i:032d}", title=f"anon{i}")
    for i in range(2):
        db.log_download_started(f"{i + 10:032d}", title=f"auth{i}", user_id=user["id"])

    stats = db.get_download_stats()
    assert stats["total"] == 5
    assert stats["anonimas"] == 3
    assert stats["autenticadas"] == 2


def test_stats_count_completed(db):
    db.log_download_started("a" * 32)
    db.log_download_started("b" * 32)
    db.complete_download_event("a" * 32, status="complete")
    db.complete_download_event("b" * 32, status="error")

    stats = db.get_download_stats()
    assert stats["total"] == 2
    assert stats["completadas"] == 1


def test_stats_rank_most_downloaded(db):
    for i in range(3):
        db.log_download_started(f"{i:032d}", title="La repetida")
    db.log_download_started("f" * 32, title="La otra")

    top = db.get_download_stats()["mas_descargadas"]
    assert top[0]["title"] == "La repetida"
    assert top[0]["veces"] == 3


def test_stats_ignore_empty_titles(db):
    db.log_download_started("a" * 32, title="")
    titulos = [t["title"] for t in db.get_download_stats()["mas_descargadas"]]
    assert "" not in titulos


def test_stats_group_by_day(db):
    for i in range(3):
        db.log_download_started(f"{i:032d}")
    por_dia = db.get_download_stats()["por_dia"]
    assert len(por_dia) == 1
    assert por_dia[0]["descargas"] == 3


# ========================================
# Privacidad: qué NO se guarda
# ========================================

def test_no_personal_data_columns(db):
    """
    Para contar uso y ver títulos no hacen falta IP ni user-agent, y guardarlos
    convertiría esta tabla en datos personales.
    """
    conn = db.get_db()
    columnas = {r[1].lower() for r in conn.execute("PRAGMA table_info(download_events)")}
    conn.close()

    prohibidas = {"ip", "ip_address", "remote_addr", "user_agent", "email"}
    assert not (columnas & prohibidas), f"columnas con datos personales: {columnas & prohibidas}"


def test_events_survive_user_deletion(db, user):
    """
    El evento no lleva clave foránea a propósito: borrar una cuenta no debe
    falsear el histórico de uso.
    """
    db.log_download_started("a" * 32, title="Suya", user_id=user["id"])

    conn = db.get_db()
    conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    conn.commit()
    conn.close()

    assert db.get_download_stats()["total"] == 1


# ========================================
# Integración con los endpoints
# ========================================

def test_start_download_records_an_event(client, srv, db, monkeypatch):
    monkeypatch.setattr(srv, "db", db)
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)
    monkeypatch.setattr(srv, "prefetch_video_metadata", lambda *a, **k: None)

    resp = client.post("/api/start-download",
                       json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
    assert resp.status_code == 200

    eventos = db.get_recent_downloads()
    assert len(eventos) == 1
    assert eventos[0]["download_id"] == resp.get_json()["download_id"]
    assert eventos[0]["user_id"] is None, "una descarga sin sesión debe registrarse como anónima"


def test_batch_download_records_an_event(client, srv, db, monkeypatch):
    monkeypatch.setattr(srv, "db", db)
    monkeypatch.setattr(srv.batch_executor, "submit", lambda *a, **k: None)

    videos = [{"url": f"https://youtu.be/v{i:09d}"} for i in range(4)]
    client.post("/api/start-batch-download", json={"videos": videos})

    evento = db.get_recent_downloads()[0]
    assert evento["content_type"] == "batch"
    assert evento["total_items"] == 4


def test_search_download_records_an_event(client, srv, db, monkeypatch):
    monkeypatch.setattr(srv, "db", db)
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)

    client.post("/api/start-download", json={"url": "bad bunny"})
    assert db.get_recent_downloads()[0]["content_type"] == "search"
