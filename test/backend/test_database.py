"""
Capa de persistencia (database.py).

Lo que más importa aquí es el aislamiento entre usuarios: que los datos de una
cuenta no puedan aparecer jamás en otra.
"""

import sqlite3

import pytest


# ========================================
# Esquema
# ========================================

def test_tables_are_created(db):
    conn = db.get_db()
    tablas = {
        r["name"] for r in
        conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    conn.close()
    assert {"users", "download_history", "favorites"} <= tablas


def test_indexes_are_created(db):
    conn = db.get_db()
    indices = {
        r["name"] for r in
        conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()
    }
    conn.close()
    assert "idx_history_user" in indices
    assert "idx_favorites_user" in indices


def test_init_is_idempotent(db):
    db.init_db()
    db.init_db()
    assert db.get_or_create_user("x@y.z") is not None


def test_foreign_keys_are_enabled(db):
    conn = db.get_db()
    activo = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    conn.close()
    assert activo == 1


def test_wal_mode_is_enabled(db):
    conn = db.get_db()
    modo = conn.execute("PRAGMA journal_mode").fetchone()[0]
    conn.close()
    assert modo.lower() == "wal"


# ========================================
# Usuarios
# ========================================

def test_creates_new_user(db):
    u = db.get_or_create_user("nuevo@test.com", "Nombre", "http://pic")
    assert u["email"] == "nuevo@test.com"
    assert u["name"] == "Nombre"
    assert u["picture"] == "http://pic"
    assert u["id"] > 0


def test_same_email_returns_same_user(db):
    a = db.get_or_create_user("mismo@test.com", "A")
    b = db.get_or_create_user("mismo@test.com", "B")
    assert a["id"] == b["id"]


def test_profile_is_refreshed_on_login(db):
    db.get_or_create_user("u@test.com", "Viejo", "pic1")
    actualizado = db.get_or_create_user("u@test.com", "Nuevo", "pic2")
    assert actualizado["name"] == "Nuevo"
    assert actualizado["picture"] == "pic2"


def test_last_login_is_updated(db):
    primero = db.get_or_create_user("u@test.com", "N")
    segundo = db.get_or_create_user("u@test.com", "N")
    assert segundo["last_login"] >= primero["last_login"]


def test_get_user_by_id(db, user):
    assert db.get_user_by_id(user["id"])["email"] == user["email"]


def test_get_unknown_user_is_none(db):
    assert db.get_user_by_id(999999) is None


def test_optional_fields_default_to_empty(db):
    u = db.get_or_create_user("minimo@test.com")
    assert u["name"] == ""
    assert u["picture"] == ""


def test_email_is_unique(db):
    db.get_or_create_user("unico@test.com")
    conn = db.get_db()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO users (email) VALUES (?)", ("unico@test.com",))
        conn.commit()
    conn.close()


# ========================================
# Historial
# ========================================

def _video(vid="abc123", title="Canción"):
    return {
        "id": vid,
        "title": title,
        "thumbnail": f"http://img/{vid}.jpg",
        "channel": "Canal",
        "url": f"https://www.youtube.com/watch?v={vid}",
    }


def test_history_starts_empty(db, user):
    assert db.get_history(user["id"]) == []


def test_adds_to_history(db, user):
    db.add_history(user["id"], _video())
    h = db.get_history(user["id"])
    assert len(h) == 1
    assert h[0]["id"] == "abc123"
    assert h[0]["title"] == "Canción"


def test_history_is_newest_first(db, user):
    for i in range(5):
        db.add_history(user["id"], {**_video(f"vid{i}"), "downloadedAt": f"2026-01-0{i+1}T00:00:00"})
    ids = [x["id"] for x in db.get_history(user["id"])]
    assert ids == ["vid4", "vid3", "vid2", "vid1", "vid0"]


def test_redownload_moves_entry_to_top(db, user):
    db.add_history(user["id"], {**_video("a"), "downloadedAt": "2026-01-01T00:00:00"})
    db.add_history(user["id"], {**_video("b"), "downloadedAt": "2026-01-02T00:00:00"})
    db.add_history(user["id"], {**_video("a"), "downloadedAt": "2026-01-03T00:00:00"})

    h = db.get_history(user["id"])
    assert len(h) == 2, "la re-descarga debe reemplazar, no duplicar"
    assert h[0]["id"] == "a"


def test_history_is_capped_at_1000(db, user):
    for i in range(1010):
        db.add_history(user["id"], {**_video(f"v{i:05d}"), "downloadedAt": f"2026-01-01T00:{i//60:02d}:{i%60:02d}"})
    assert len(db.get_history(user["id"])) <= 1000


def test_clear_history(db, user):
    db.add_history(user["id"], _video())
    db.clear_history(user["id"])
    assert db.get_history(user["id"]) == []


def test_history_defaults_missing_title(db, user):
    db.add_history(user["id"], {"id": "x", "url": "http://u"})
    assert db.get_history(user["id"])[0]["title"] == "Sin título"


def test_history_is_isolated_between_users(db, user, other_user):
    db.add_history(user["id"], _video("mio"))
    db.add_history(other_user["id"], _video("suyo"))

    assert [x["id"] for x in db.get_history(user["id"])] == ["mio"]
    assert [x["id"] for x in db.get_history(other_user["id"])] == ["suyo"]


def test_clear_history_only_affects_one_user(db, user, other_user):
    db.add_history(user["id"], _video("mio"))
    db.add_history(other_user["id"], _video("suyo"))
    db.clear_history(user["id"])
    assert len(db.get_history(other_user["id"])) == 1


def test_history_preserves_unicode(db, user):
    db.add_history(user["id"], _video(title="Cançó 日本語 🎵"))
    assert db.get_history(user["id"])[0]["title"] == "Cançó 日本語 🎵"


# ========================================
# Favoritos
# ========================================

def test_favorites_start_empty(db, user):
    assert db.get_favorites(user["id"]) == []


def test_adds_favorite(db, user):
    db.add_favorite(user["id"], {**_video(), "duration": 210})
    f = db.get_favorites(user["id"])
    assert len(f) == 1
    assert f[0]["id"] == "abc123"
    assert f[0]["duration"] == 210


def test_favorite_is_not_duplicated(db, user):
    db.add_favorite(user["id"], _video("x"))
    db.add_favorite(user["id"], _video("x"))
    assert len(db.get_favorites(user["id"])) == 1


def test_readding_favorite_updates_metadata(db, user):
    db.add_favorite(user["id"], {**_video("x"), "title": "Viejo"})
    db.add_favorite(user["id"], {**_video("x"), "title": "Nuevo"})
    favs = db.get_favorites(user["id"])
    assert len(favs) == 1
    assert favs[0]["title"] == "Nuevo"


def test_removes_favorite(db, user):
    db.add_favorite(user["id"], _video("x"))
    db.remove_favorite(user["id"], "x")
    assert db.get_favorites(user["id"]) == []


def test_removing_unknown_favorite_is_silent(db, user):
    db.remove_favorite(user["id"], "no-existe")  # no debe lanzar


def test_is_favorite(db, user):
    db.add_favorite(user["id"], _video("x"))
    assert db.is_favorite(user["id"], "x") is True
    assert db.is_favorite(user["id"], "y") is False


def test_favorites_are_isolated_between_users(db, user, other_user):
    db.add_favorite(user["id"], _video("mio"))
    assert db.is_favorite(user["id"], "mio") is True
    assert db.is_favorite(other_user["id"], "mio") is False
    assert db.get_favorites(other_user["id"]) == []


def test_same_video_can_be_favorite_for_two_users(db, user, other_user):
    db.add_favorite(user["id"], _video("compartido"))
    db.add_favorite(other_user["id"], _video("compartido"))
    assert db.is_favorite(user["id"], "compartido")
    assert db.is_favorite(other_user["id"], "compartido")


def test_removing_favorite_only_affects_one_user(db, user, other_user):
    db.add_favorite(user["id"], _video("x"))
    db.add_favorite(other_user["id"], _video("x"))
    db.remove_favorite(user["id"], "x")
    assert db.is_favorite(other_user["id"], "x") is True


def test_favorites_are_newest_first(db, user):
    for i in range(3):
        db.add_favorite(user["id"], {**_video(f"f{i}"), "addedAt": f"2026-01-0{i+1}T00:00:00"})
    assert [x["id"] for x in db.get_favorites(user["id"])] == ["f2", "f1", "f0"]


def test_favorite_duration_defaults_to_zero(db, user):
    db.add_favorite(user["id"], _video("x"))
    assert db.get_favorites(user["id"])[0]["duration"] == 0


# ========================================
# Borrado en cascada
# ========================================

def test_deleting_user_cascades(db, user):
    db.add_history(user["id"], _video("h"))
    db.add_favorite(user["id"], _video("f"))

    conn = db.get_db()
    conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    conn.commit()

    restantes_h = conn.execute(
        "SELECT COUNT(*) FROM download_history WHERE user_id = ?", (user["id"],)
    ).fetchone()[0]
    restantes_f = conn.execute(
        "SELECT COUNT(*) FROM favorites WHERE user_id = ?", (user["id"],)
    ).fetchone()[0]
    conn.close()

    assert restantes_h == 0
    assert restantes_f == 0


# ========================================
# sync_user_data
# ========================================

def test_sync_inserts_new_items(db, user):
    db.sync_user_data(user["id"], [_video("h1")], [_video("f1")])
    assert len(db.get_history(user["id"])) == 1
    assert len(db.get_favorites(user["id"])) == 1


def test_sync_does_not_duplicate_existing(db, user):
    db.add_history(user["id"], _video("h1"))
    db.add_favorite(user["id"], _video("f1"))
    db.sync_user_data(user["id"], [_video("h1")], [_video("f1")])
    assert len(db.get_history(user["id"])) == 1
    assert len(db.get_favorites(user["id"])) == 1


def test_sync_preserves_server_data(db, user):
    """El sync añade, nunca reemplaza lo que ya había en el servidor."""
    db.add_history(user["id"], _video("servidor"))
    db.sync_user_data(user["id"], [_video("local")], [])
    ids = {x["id"] for x in db.get_history(user["id"])}
    assert ids == {"servidor", "local"}


def test_sync_with_empty_lists(db, user):
    db.sync_user_data(user["id"], [], [])
    assert db.get_history(user["id"]) == []


def test_sync_with_none(db, user):
    db.sync_user_data(user["id"], None, None)  # no debe lanzar


def test_sync_skips_items_without_id(db, user):
    db.sync_user_data(user["id"], [{"title": "sin id"}], [{"title": "sin id"}])
    assert db.get_history(user["id"]) == []
    assert db.get_favorites(user["id"]) == []


def test_sync_is_isolated_between_users(db, user, other_user):
    db.sync_user_data(user["id"], [_video("mio")], [_video("mio")])
    assert db.get_history(other_user["id"]) == []
    assert db.get_favorites(other_user["id"]) == []


def test_sync_handles_large_batch(db, user):
    historial = [_video(f"h{i:04d}") for i in range(200)]
    favoritos = [_video(f"f{i:04d}") for i in range(200)]
    db.sync_user_data(user["id"], historial, favoritos)
    assert len(db.get_history(user["id"])) == 200
    assert len(db.get_favorites(user["id"])) == 200


# ========================================
# Inyección SQL
# ========================================

@pytest.mark.parametrize("malicioso", [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "abc'); DELETE FROM favorites; --",
])
def test_sql_injection_in_video_id(db, user, malicioso):
    """Todo va por consultas parametrizadas: el texto se guarda como dato."""
    db.add_favorite(user["id"], _video(malicioso))
    favs = db.get_favorites(user["id"])
    assert len(favs) == 1
    assert favs[0]["id"] == malicioso

    conn = db.get_db()
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 1
    conn.close()


@pytest.mark.parametrize("malicioso", [
    "'; DROP TABLE users; --",
    "admin'--@test.com",
])
def test_sql_injection_in_email(db, malicioso):
    u = db.get_or_create_user(malicioso, "N")
    assert u["email"] == malicioso
    conn = db.get_db()
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 1
    conn.close()
