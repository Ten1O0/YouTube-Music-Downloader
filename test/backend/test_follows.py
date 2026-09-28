"""
Listas de YouTube seguidas (plan 14): leerlas, apuntar lo nuevo una sola vez,
los límites, la validación y que cada cuenta solo vea lo suyo.
"""

import json
import sqlite3
import subprocess

import pytest

import listas_youtube as ly

LISTA = "PLe2eTestList01"


def cancion(i):
    return {"video_id": f"v{i:010d}", "title": f"Tema {i}", "channel": "Canal", "duration": 200}


def leida(*ids, titulo="Mi lista"):
    return {"titulo": titulo, "canciones": [cancion(i) for i in ids]}


# ========================================
# Leer una lista
# ========================================

@pytest.mark.parametrize("texto, esperado", [
    (f"https://www.youtube.com/playlist?list={LISTA}", LISTA),
    (f"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list={LISTA}&index=2", LISTA),
    (LISTA, LISTA),
    ("RDdQw4w9WgXcQ", None),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ", None),
    ("corto", None),
    ("PL../../etc/passwd", None),
    (None, None),
    (123, None),
])
def test_only_real_playlists_can_be_followed(texto, esperado):
    assert ly.lista_de(texto) == esperado


def test_the_output_is_read_without_repeats_or_fake_ids():
    salida = "\n".join([
        json.dumps({"id": "aaaaaaaaaaa", "title": "Uno", "channel": "C", "duration": 100, "playlist_title": "Lista"}),
        json.dumps({"id": "aaaaaaaaaaa", "title": "Uno otra vez"}),
        json.dumps({"id": "no-es-id", "title": "Mala"}),
        "no es json",
        json.dumps({"id": "bbbbbbbbbbb", "title": "Dos", "uploader": "U", "duration": -5}),
    ])
    r = ly.leer_salida(salida)
    assert r["titulo"] == "Lista"
    assert [(c["video_id"], c["channel"], c["duration"]) for c in r["canciones"]] == [("aaaaaaaaaaa", "C", 100), ("bbbbbbbbbbb", "U", 0)]


def test_reading_calls_yt_dlp_with_an_argument_list_and_low_priority(monkeypatch):
    llamadas = []

    def run(cmd, **kw):
        llamadas.append((cmd, kw))
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"id": "aaaaaaaaaaa", "title": "Uno"}), stderr="")

    monkeypatch.setattr(ly.subprocess, "run", run)
    monkeypatch.setattr(ly.shutil, "which", lambda n: "/usr/bin/nice")
    monkeypatch.setattr(ly.os, "name", "posix")
    assert ly.leer_lista(LISTA)["canciones"][0]["video_id"] == "aaaaaaaaaaa"
    cmd, kw = llamadas[0]
    assert cmd[:3] == ["nice", "-n", "10"] and isinstance(cmd, list) and "shell" not in kw
    assert f"https://www.youtube.com/playlist?list={LISTA}" in cmd
    assert kw["timeout"] == ly.TIMEOUT


def _falla_privada(cmd, **kw):
    return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="private")


def _falla_tiempo(cmd, **kw):
    raise subprocess.TimeoutExpired("yt", 60)


@pytest.mark.parametrize("fallo", [_falla_privada, _falla_tiempo])
def test_an_unreadable_playlist_raises(monkeypatch, fallo):
    monkeypatch.setattr(ly.subprocess, "run", fallo)
    with pytest.raises(ly.ListaNoDisponible):
        ly.leer_lista(LISTA)


def test_a_mix_is_never_read(monkeypatch):
    monkeypatch.setattr(ly.subprocess, "run", lambda *a, **k: pytest.fail("no debía llamar a yt-dlp"))
    with pytest.raises(ly.ListaNoDisponible):
        ly.leer_lista("RDdQw4w9WgXcQ")


# ========================================
# Base de datos
# ========================================

def test_what_the_list_had_when_followed_is_not_new(db, user):
    db.seguir_lista(user["id"], LISTA, "Mi lista", "17", True, leida(1, 2)["canciones"])
    [lista] = db.listas_seguidas(user["id"])
    assert (lista["listId"], lista["title"], lista["localPlaylistId"], lista["autoDownload"]) == (LISTA, "Mi lista", "17", True)
    assert lista["nuevas"] == []


def test_new_songs_are_noted_once_and_delivered_once(db, user):
    db.seguir_lista(user["id"], LISTA, "Mi lista", "17", True, leida(1, 2)["canciones"])
    assert db.apuntar_comprobacion(user["id"], LISTA, leida(1, 2, 3)) == 1
    assert db.apuntar_comprobacion(user["id"], LISTA, leida(1, 2, 3)) == 0
    [lista] = db.listas_seguidas(user["id"])
    assert [c["videoId"] for c in lista["nuevas"]] == ["v0000000003"]
    db.marcar_entregadas(user["id"], LISTA, ["v0000000003"])
    assert db.listas_seguidas(user["id"])[0]["nuevas"] == []


def test_removed_from_youtube_is_not_removed_here(db, user):
    db.seguir_lista(user["id"], LISTA, "L", "17", True, leida(1, 2)["canciones"])
    db.apuntar_comprobacion(user["id"], LISTA, leida(2))
    n = sqlite3.connect(db.DB_PATH).execute("SELECT COUNT(*) FROM followed_items").fetchone()[0]
    assert n == 2


def test_five_failures_in_a_row_stop_checking_it(db, user):
    db.seguir_lista(user["id"], LISTA, "L", "17", True, [])
    for _ in range(4):
        db.apuntar_comprobacion(user["id"], LISTA, None)
    assert db.listas_seguidas(user["id"])[0]["available"] is True
    db.apuntar_comprobacion(user["id"], LISTA, None)
    assert db.listas_seguidas(user["id"])[0]["available"] is False
    con = sqlite3.connect(db.DB_PATH)
    con.execute("UPDATE followed_playlists SET last_checked = NULL")
    con.commit()
    assert db.listas_por_comprobar() == []


def test_a_success_resets_the_failures(db, user):
    db.seguir_lista(user["id"], LISTA, "L", "17", True, [])
    for _ in range(4):
        db.apuntar_comprobacion(user["id"], LISTA, None)
    db.apuntar_comprobacion(user["id"], LISTA, leida(1))
    for _ in range(4):
        db.apuntar_comprobacion(user["id"], LISTA, None)
    assert db.listas_seguidas(user["id"])[0]["available"] is True


def test_a_list_that_grows_too_big_stops_being_checked(db, user, monkeypatch):
    monkeypatch.setattr(db, "MAX_CANCIONES_VIGILADAS", 3)
    db.seguir_lista(user["id"], LISTA, "L", "17", True, [])
    db.apuntar_comprobacion(user["id"], LISTA, leida(1, 2, 3, 4))
    assert db.listas_seguidas(user["id"])[0]["available"] is False


def test_only_lists_not_checked_for_six_hours_are_due(db, user):
    db.seguir_lista(user["id"], LISTA, "L", "17", True, [])
    assert db.listas_por_comprobar() == []
    con = sqlite3.connect(db.DB_PATH)
    con.execute("UPDATE followed_playlists SET last_checked = '2020-01-01T00:00:00+00:00'")
    con.commit()
    assert db.listas_por_comprobar() == [{"user_id": user["id"], "list_id": LISTA}]


def test_at_most_20_lists_but_following_again_is_fine(db, user):
    for i in range(20):
        db.seguir_lista(user["id"], f"PLlista{i:05d}", "L", str(i), True, [])
    db.seguir_lista(user["id"], "PLlista00003", "L", "3", False, [])
    with pytest.raises(db.LimiteSuperado):
        db.seguir_lista(user["id"], "PLlistaNueva1", "L", "x", True, [])


def test_users_do_not_see_each_others_lists(db, user, other_user):
    db.seguir_lista(user["id"], LISTA, "L", "17", True, [])
    db.apuntar_comprobacion(user["id"], LISTA, leida(1))
    assert db.listas_seguidas(other_user["id"]) == []
    assert db.dejar_de_seguir(other_user["id"], LISTA) is False
    db.marcar_entregadas(other_user["id"], LISTA, ["v0000000001"])
    assert len(db.listas_seguidas(user["id"])[0]["nuevas"]) == 1


# ========================================
# La tarea periódica
# ========================================

def test_the_periodic_check_reads_each_due_list_once(db, user, monkeypatch):
    import tareas
    monkeypatch.setattr(tareas, "db", db)
    db.seguir_lista(user["id"], LISTA, "L", "17", True, leida(1)["canciones"])
    db.seguir_lista(user["id"], "PLrota000001", "R", "18", True, [])
    con = sqlite3.connect(db.DB_PATH)
    con.execute("UPDATE followed_playlists SET last_checked = NULL")
    con.commit()
    leidas = []

    def leer(lista_id):
        leidas.append(lista_id)
        if lista_id == "PLrota000001":
            raise ly.ListaNoDisponible("privada")
        return leida(1, 2)

    esperas = []
    assert tareas.comprobar_listas(leer=leer, dormir=esperas.append) == {"comprobadas": 1, "nuevas": 1, "fallidas": 1}
    assert sorted(leidas) == sorted([LISTA, "PLrota000001"])
    assert esperas == [tareas.PAUSA_ENTRE_LISTAS], "una a una, con pausa entre listas"
    # Recién comprobadas: la siguiente hora no toca
    assert tareas.comprobar_listas(leer=leer, dormir=esperas.append)["comprobadas"] == 0


# ========================================
# Rutas
# ========================================

@pytest.mark.parametrize("metodo, ruta", [
    ("get", "/api/follows"), ("post", "/api/follows"),
    ("delete", f"/api/follows/{LISTA}"), ("post", "/api/follows/entregadas"),
])
def test_follow_routes_need_a_session(client, metodo, ruta):
    assert getattr(client, metodo)(ruta, json={}).status_code == 401


def seguir(cliente, **datos):
    return cliente.post("/api/follows", json={"lista": f"https://www.youtube.com/playlist?list={LISTA}", "localPlaylistId": "17", **datos})


def test_follow_reads_the_list_and_returns_its_songs(authed_client, srv, monkeypatch):
    monkeypatch.setattr(srv, "leer_lista", lambda lista_id: leida(1, 2, titulo="Novedades"))
    r = seguir(authed_client)
    assert r.status_code == 200
    datos = r.get_json()
    assert (datos["listId"], datos["title"], [c["videoId"] for c in datos["canciones"]]) == (LISTA, "Novedades", ["v0000000001", "v0000000002"])
    assert authed_client.get("/api/follows").get_json()["listas"][0]["nuevas"] == []


@pytest.mark.parametrize("datos", [
    {"lista": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"},
    {"lista": "nada"},
    {"localPlaylistId": "../x"},
    {"localPlaylistId": 17},
    {"autoDownload": "sí"},
])
def test_follow_validates_everything(authed_client, srv, monkeypatch, datos):
    monkeypatch.setattr(srv, "leer_lista", lambda lista_id: pytest.fail("no debía leer la lista"))
    assert seguir(authed_client, **datos).status_code == 400


def test_a_private_or_deleted_list_is_502(authed_client, srv, monkeypatch):
    def falla(lista_id):
        raise ly.ListaNoDisponible("privada")
    monkeypatch.setattr(srv, "leer_lista", falla)
    assert seguir(authed_client).status_code == 502


def test_a_list_over_500_songs_is_413(authed_client, srv, monkeypatch):
    monkeypatch.setattr(srv, "leer_lista", lambda lista_id: leida(*range(501)))
    assert seguir(authed_client).status_code == 413


def test_over_20_lists_is_409(authed_client, srv, db, user, monkeypatch):
    for i in range(20):
        db.seguir_lista(user["id"], f"PLlista{i:05d}", "L", str(i), True, [])
    monkeypatch.setattr(srv, "leer_lista", lambda lista_id: leida(1))
    assert seguir(authed_client).status_code == 409


def test_delivered_and_unfollow_routes(authed_client, srv, db, user, monkeypatch):
    monkeypatch.setattr(srv, "leer_lista", lambda lista_id: leida(1))
    seguir(authed_client)
    db.apuntar_comprobacion(user["id"], LISTA, leida(1, 2))
    assert [c["videoId"] for c in authed_client.get("/api/follows").get_json()["listas"][0]["nuevas"]] == ["v0000000002"]
    assert authed_client.post("/api/follows/entregadas", json={"listId": LISTA, "videoIds": ["falso"]}).status_code == 400
    assert authed_client.post("/api/follows/entregadas", json={"listId": LISTA, "videoIds": ["v0000000002"]}).status_code == 200
    assert authed_client.get("/api/follows").get_json()["listas"][0]["nuevas"] == []
    assert authed_client.delete(f"/api/follows/{LISTA}").status_code == 200
    assert authed_client.delete(f"/api/follows/{LISTA}").status_code == 404
    assert authed_client.delete("/api/follows/RDdQw4w9WgXcQ").status_code == 400


def test_following_is_rate_limited_per_account(srv, authed_client, monkeypatch):
    monkeypatch.setattr(srv, "leer_lista", lambda lista_id: leida(1))
    srv.limiter.enabled = True
    try:
        codigos = [seguir(authed_client).status_code for _ in range(11)]
    finally:
        srv.limiter.enabled = srv.os.environ.get("YTDL_DISABLE_RATELIMIT") != "1"
    assert codigos[:10] == [200] * 10 and codigos[10] == 429
