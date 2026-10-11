"""
Sincronización de la cuenta (plan 13): esquema, operaciones de base de datos
y rutas. Lo que llega de la sincronización es dato externo: se valida todo y
un usuario nunca ve ni cambia lo de otro.
"""

import sqlite3

import pytest


# ========================================
# Esquema (T1)
# ========================================

def test_init_db_twice_is_harmless(db):
    db.init_db()
    db.init_db()
    columnas = {r[1] for r in sqlite3.connect(db.DB_PATH).execute("PRAGMA table_info(users)")}
    assert "sync_seq" in columnas


def test_an_old_database_gets_the_new_column_and_tables(db, tmp_path):
    vieja = tmp_path / "vieja.db"
    con = sqlite3.connect(vieja)
    con.execute("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', "
                "picture TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT NOT NULL DEFAULT (datetime('now')))")
    con.execute("INSERT INTO users (email) VALUES ('antes@example.com')")
    con.commit()
    con.close()
    db.DB_PATH = str(vieja)
    db.init_db()
    con = sqlite3.connect(vieja)
    assert con.execute("SELECT email, sync_seq FROM users").fetchall() == [("antes@example.com", 0)]
    tablas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"library_items", "playlists", "listens", "user_settings"} <= tablas


# ========================================
# Operaciones (T2)
# ========================================

def cancion(video_id="dQw4w9WgXcQ", **extra):
    base = {"video_id": video_id, "title": "Título", "channel": "Canal", "artist": "Artista", "track": "Tema",
            "extra": "", "editado": False, "duration": 200, "added_at": "2026-09-01T10:00:00+00:00"}
    return {"tipo": "cancion", "accion": "poner", "datos": {**base, **extra}}


def borrar_cancion(video_id="dQw4w9WgXcQ"):
    return {"tipo": "cancion", "accion": "borrar", "datos": {"video_id": video_id}}


def lista(lid="l1", songs=("dQw4w9WgXcQ",), **extra):
    base = {"id": lid, "name": "Mi lista", "description": "", "songs": list(songs), "created_at": "2026-09-01T10:00:00+00:00"}
    return {"tipo": "lista", "accion": "poner", "datos": {**base, **extra}}


def test_each_change_increments_the_sequence(db, user):
    assert db.aplicar_cambios(user["id"], [cancion(), lista()]) == 2
    assert db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa")]) == 3
    assert db.cambios_desde(user["id"], 0)["seq"] == 3


def test_changes_since_n_only_returns_the_newer_rows(db, user):
    db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa"), cancion("bbbbbbbbbbb")])
    db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa", artist="Otro")])
    recientes = db.cambios_desde(user["id"], 2)
    assert [c["videoId"] for c in recientes["biblioteca"]] == ["aaaaaaaaaaa"]
    assert recientes["biblioteca"][0]["artist"] == "Otro"
    assert len(db.cambios_desde(user["id"], 0)["biblioteca"]) == 2


def test_putting_again_updates_but_keeps_the_added_date(db, user):
    db.aplicar_cambios(user["id"], [cancion(added_at="2026-01-01T00:00:00+00:00")])
    db.aplicar_cambios(user["id"], [cancion(track="Nuevo", editado=True, added_at="2026-09-09T00:00:00+00:00")])
    [c] = db.cambios_desde(user["id"], 0)["biblioteca"]
    assert (c["track"], c["editado"], c["addedAt"]) == ("Nuevo", True, "2026-01-01T00:00:00+00:00")


def test_deleting_leaves_a_tombstone_that_other_devices_see(db, user):
    db.aplicar_cambios(user["id"], [cancion()])
    seq = db.aplicar_cambios(user["id"], [borrar_cancion()])
    [c] = db.cambios_desde(user["id"], seq - 1)["biblioteca"]
    assert c["deleted"] is True
    # Y volver a ponerla la resucita
    db.aplicar_cambios(user["id"], [cancion()])
    assert db.cambios_desde(user["id"], 0)["biblioteca"][0]["deleted"] is False


def test_lists_keep_their_song_order(db, user):
    db.aplicar_cambios(user["id"], [lista(songs=["bbbbbbbbbbb", "aaaaaaaaaaa"])])
    [pl] = db.cambios_desde(user["id"], 0)["listas"]
    assert pl["songs"] == ["bbbbbbbbbbb", "aaaaaaaaaaa"]
    db.aplicar_cambios(user["id"], [{"tipo": "lista", "accion": "borrar", "datos": {"id": "l1"}}])
    assert db.cambios_desde(user["id"], 0)["listas"][0]["deleted"] is True


def test_settings_travel_whole(db, user):
    assert db.cambios_desde(user["id"], 0)["ajustes"] is None
    db.aplicar_cambios(user["id"], [{"tipo": "ajustes", "accion": "poner", "datos": {"idioma": "fr"}}])
    assert db.cambios_desde(user["id"], 0)["ajustes"] == {"idioma": "fr"}
    assert db.cambios_desde(user["id"], 1)["ajustes"] is None


def test_a_failing_change_applies_none(db, user):
    db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa")])
    malo = {"tipo": "cancion", "accion": "poner", "datos": {"video_id": "bbbbbbbbbbb"}}  # le faltan campos
    with pytest.raises(KeyError):
        db.aplicar_cambios(user["id"], [cancion("ccccccccccc"), malo])
    datos = db.cambios_desde(user["id"], 0)
    assert [c["videoId"] for c in datos["biblioteca"]] == ["aaaaaaaaaaa"]
    assert datos["seq"] == 1


def test_account_limits_reject_the_whole_batch(db, user, monkeypatch):
    monkeypatch.setattr(db, "MAX_CANCIONES_CUENTA", 2)
    db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa"), cancion("bbbbbbbbbbb")])
    with pytest.raises(db.LimiteSuperado):
        db.aplicar_cambios(user["id"], [cancion("ccccccccccc")])
    assert db.cambios_desde(user["id"], 0)["seq"] == 2
    # Borrar libera sitio
    db.aplicar_cambios(user["id"], [borrar_cancion("aaaaaaaaaaa"), cancion("ccccccccccc")])


def test_users_never_see_each_other(db, user, other_user):
    db.aplicar_cambios(user["id"], [cancion(), lista()])
    db.aplicar_cambios(other_user["id"], [borrar_cancion(), {"tipo": "lista", "accion": "borrar", "datos": {"id": "l1"}}])
    mio = db.cambios_desde(user["id"], 0)
    assert mio["biblioteca"][0]["deleted"] is False and mio["listas"][0]["deleted"] is False
    assert db.cambios_desde(other_user["id"], 0) == {"seq": 2, "biblioteca": [], "listas": [], "ajustes": None}


def escucha(i, **extra):
    return {"id": i, "video_id": "dQw4w9WgXcQ", "artist": "A", "track": "T", "t": 1_700_000_000_000 + i, "seconds": 30, **extra}


def test_repeated_listens_are_not_duplicated_and_keep_the_most_seconds(db, user):
    db.registrar_escuchas(user["id"], "movil", [escucha(1), escucha(2)])
    db.registrar_escuchas(user["id"], "movil", [escucha(2, seconds=190), escucha(1, seconds=5)])
    db.registrar_escuchas(user["id"], "ordenador", [escucha(1)])
    filas = sqlite3.connect(db.DB_PATH).execute("SELECT device, local_id, seconds FROM listens ORDER BY device, local_id").fetchall()
    assert filas == [("movil", 1, 30), ("movil", 2, 190), ("ordenador", 1, 30)]


def test_recently_deleted_and_restore(db, user):
    db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa"), cancion("bbbbbbbbbbb")])
    db.aplicar_cambios(user["id"], [borrar_cancion("aaaaaaaaaaa"), borrar_cancion("bbbbbbbbbbb")])
    assert {c["videoId"] for c in db.eliminadas_recientes(user["id"])} == {"aaaaaaaaaaa", "bbbbbbbbbbb"}
    seq = db.restaurar(user["id"], ["aaaaaaaaaaa", "zzzzzzzzzzz"])
    assert [c["videoId"] for c in db.eliminadas_recientes(user["id"])] == ["bbbbbbbbbbb"]
    vuelta = db.cambios_desde(user["id"], seq - 2)["biblioteca"]
    assert [(c["videoId"], c["deleted"]) for c in vuelta] == [("aaaaaaaaaaa", False)]


def test_old_tombstones_are_purged_and_recent_ones_kept(db, user):
    db.aplicar_cambios(user["id"], [cancion("aaaaaaaaaaa"), cancion("bbbbbbbbbbb"), lista()])
    db.aplicar_cambios(user["id"], [borrar_cancion("aaaaaaaaaaa"), borrar_cancion("bbbbbbbbbbb"),
                                    {"tipo": "lista", "accion": "borrar", "datos": {"id": "l1"}}])
    con = sqlite3.connect(db.DB_PATH)
    con.execute("UPDATE library_items SET deleted_at = '2020-01-01T00:00:00+00:00' WHERE video_id = 'aaaaaaaaaaa'")
    con.execute("UPDATE playlists SET deleted_at = '2020-01-01T00:00:00+00:00'")
    con.commit()
    assert db.purgar_lapidas() == 2
    assert [c["videoId"] for c in db.cambios_desde(user["id"], 0)["biblioteca"]] == ["bbbbbbbbbbb"]
    # Una borrada hace más de 30 días ya no se puede restaurar
    assert db.eliminadas_recientes(user["id"], dias=0) == []


# ========================================
# Rutas (T3)
# ========================================

DISP = "movil-1234-abcd"


def c_poner(video_id="dQw4w9WgXcQ", **extra):
    return {"tipo": "cancion", "accion": "poner", "datos": {"videoId": video_id, "title": "T", "addedAt": "2026-09-01T10:00:00Z", **extra}}


def enviar(cliente, cambios, dispositivo=DISP):
    return cliente.post("/api/sync", json={"dispositivo": dispositivo, "cambios": cambios})


@pytest.mark.parametrize("metodo, ruta", [
    ("get", "/api/sync"), ("post", "/api/sync"), ("post", "/api/sync/escuchas"),
    ("get", "/api/sync/eliminadas"), ("post", "/api/sync/restaurar"),
])
def test_every_sync_route_needs_a_session(client, metodo, ruta):
    assert getattr(client, metodo)(ruta, json={}).status_code == 401


def test_round_trip_put_and_read(authed_client):
    r = enviar(authed_client, [c_poner(artist="Queen", editado=True), {"tipo": "lista", "accion": "poner",
               "datos": {"id": "pl_1", "name": "  Viaje  ", "songs": ["dQw4w9WgXcQ", "dQw4w9WgXcQ"]}}])
    assert r.status_code == 200 and r.get_json() == {"seq": 2}
    datos = authed_client.get("/api/sync?desde=0").get_json()
    assert datos["biblioteca"][0]["artist"] == "Queen" and datos["biblioteca"][0]["editado"] is True
    assert datos["listas"][0]["name"] == "Viaje"
    assert datos["listas"][0]["songs"] == ["dQw4w9WgXcQ"], "repetidas, una vez"
    assert authed_client.get("/api/sync?desde=2").get_json()["biblioteca"] == []


def test_texts_are_cut_and_control_characters_removed(authed_client):
    enviar(authed_client, [c_poner(artist="A" * 500, track="Tema\x00\x07 malo", title="<img src=x onerror=alert(1)>")])
    [c] = authed_client.get("/api/sync").get_json()["biblioteca"]
    assert len(c["artist"]) == 120
    assert "\x00" not in c["track"]
    # El HTML se guarda como texto: lo escapa quien lo pinta (plan 10, T1)
    assert c["title"] == "<img src=x onerror=alert(1)>"


@pytest.mark.parametrize("cambio", [
    c_poner("corto"),
    c_poner("dQw4w9WgXc!"),
    c_poner(title=123),
    c_poner(editado="sí"),
    c_poner(duration=-1),
    c_poner(duration=True),
    c_poner(duration=float("inf")),
    c_poner(addedAt="ayer"),
    {"tipo": "cancion", "accion": "poner", "datos": "no es un objeto"},
    {"tipo": "cancion", "accion": "quemar", "datos": {"videoId": "dQw4w9WgXcQ"}},
    {"tipo": "usuario", "accion": "poner", "datos": {}},
    {"tipo": "lista", "accion": "poner", "datos": {"id": "../etc", "name": "x"}},
    {"tipo": "lista", "accion": "poner", "datos": {"id": "l1", "name": "   "}},
    {"tipo": "lista", "accion": "poner", "datos": {"id": "l1", "name": "x" * 41}},
    {"tipo": "lista", "accion": "poner", "datos": {"id": "l1", "name": "x", "songs": ["falso"]}},
    {"tipo": "lista", "accion": "poner", "datos": {"id": "l1", "name": "x", "songs": ["dQw4w9WgXcQ"] * 1001}},
    {"tipo": "ajustes", "accion": "poner", "datos": {"idioma": "klingon"}},
    {"tipo": "ajustes", "accion": "poner", "datos": {"reproduccion": {"fundido": 7}}},
    {"tipo": "ajustes", "accion": "poner", "datos": {"reproduccion": {"igualar": "no"}}},
    {"tipo": "ajustes", "accion": "borrar", "datos": {}},
    "no es un objeto",
])
def test_each_invalid_field_is_400_and_nothing_is_applied(authed_client, cambio):
    r = enviar(authed_client, [c_poner("aaaaaaaaaaa"), cambio])
    assert r.status_code == 400
    assert authed_client.get("/api/sync").get_json()["seq"] == 0


@pytest.mark.parametrize("cuerpo", [
    {"cambios": []},
    {"dispositivo": "x", "cambios": []},
    {"dispositivo": "../../etc/passwd", "cambios": []},
    {"dispositivo": DISP, "cambios": "no"},
    {"dispositivo": DISP, "cambios": [c_poner()] * 501},
])
def test_bad_envelope_is_400(authed_client, cuerpo):
    assert authed_client.post("/api/sync", json=cuerpo).status_code == 400


def test_unknown_settings_keys_are_dropped(authed_client):
    enviar(authed_client, [{"tipo": "ajustes", "accion": "poner", "datos": {
        "idioma": "de", "tema": "rosa", "__proto__": {"x": 1}, "reproduccion": {"fundido": 6, "otra": 1}}}])
    assert authed_client.get("/api/sync").get_json()["ajustes"] == {"idioma": "de", "reproduccion": {"fundido": 6}}


def test_a_user_id_in_the_body_is_ignored(authed_client, db, other_user):
    enviar(authed_client, [dict(c_poner(), user_id=other_user["id"])])
    authed_client.post("/api/sync", json={"dispositivo": DISP, "user_id": other_user["id"], "cambios": [c_poner("aaaaaaaaaaa")]})
    assert db.cambios_desde(other_user["id"], 0)["biblioteca"] == []


def test_desde_must_be_a_non_negative_number(authed_client):
    assert authed_client.get("/api/sync?desde=abc").status_code == 400
    assert authed_client.get("/api/sync?desde=-1").status_code == 400


def test_a_body_over_2_mb_is_413(authed_client):
    r = authed_client.post("/api/sync", data=b"x" * (2 * 1024 * 1024 + 1), content_type="application/json")
    assert r.status_code == 413


def test_going_over_the_account_limit_is_413(authed_client, db, monkeypatch):
    monkeypatch.setattr(db, "MAX_CANCIONES_CUENTA", 1)
    assert enviar(authed_client, [c_poner("aaaaaaaaaaa"), c_poner("bbbbbbbbbbb")]).status_code == 413


def test_listens_route_is_idempotent(authed_client, db, user):
    escucha = {"id": 7, "videoId": "dQw4w9WgXcQ", "artista": "A", "cancion": "T", "t": 1_700_000_000_000, "s": 40}
    for _ in range(2):
        r = authed_client.post("/api/sync/escuchas", json={"dispositivo": DISP, "escuchas": [escucha]})
        assert r.status_code == 200
    assert sqlite3.connect(db.DB_PATH).execute("SELECT COUNT(*) FROM listens").fetchone()[0] == 1


@pytest.mark.parametrize("escucha", [
    {"id": -1, "videoId": "dQw4w9WgXcQ", "t": 1, "s": 1},
    {"id": 1, "videoId": "no", "t": 1, "s": 1},
    {"id": 1, "videoId": "dQw4w9WgXcQ", "t": 10 ** 16, "s": 1},
    {"id": 1, "videoId": "dQw4w9WgXcQ", "t": 1, "s": 999_999},
    {"id": "1", "videoId": "dQw4w9WgXcQ", "t": 1, "s": 1},
])
def test_invalid_listens_are_400(authed_client, escucha):
    assert authed_client.post("/api/sync/escuchas", json={"dispositivo": DISP, "escuchas": [escucha]}).status_code == 400


def test_trash_and_restore_routes(authed_client):
    enviar(authed_client, [c_poner("aaaaaaaaaaa")])
    enviar(authed_client, [{"tipo": "cancion", "accion": "borrar", "datos": {"videoId": "aaaaaaaaaaa"}}])
    assert [c["videoId"] for c in authed_client.get("/api/sync/eliminadas").get_json()["canciones"]] == ["aaaaaaaaaaa"]
    assert authed_client.post("/api/sync/restaurar", json={"videoIds": ["no-valido"]}).status_code == 400
    assert authed_client.post("/api/sync/restaurar", json={"videoIds": ["aaaaaaaaaaa"]}).status_code == 200
    assert authed_client.get("/api/sync/eliminadas").get_json()["canciones"] == []


def test_sync_rate_limit_is_per_account(srv, authed_client):
    srv.limiter.enabled = True
    try:
        codigos = [authed_client.get("/api/sync").status_code for _ in range(31)]
    finally:
        srv.limiter.enabled = srv.os.environ.get("YTDL_DISABLE_RATELIMIT") != "1"
    assert codigos[:30] == [200] * 30
    assert codigos[30] == 429


def test_a_column_added_meanwhile_by_another_process_is_fine(db, monkeypatch):
    """
    Dos procesos arrancando a la vez: los dos miran la tabla, no ven la columna
    y la añaden. Aquí la otra la añade justo entre la comprobación y el ALTER.
    """
    con = sqlite3.connect(db.DB_PATH)
    con.execute("ALTER TABLE users DROP COLUMN sync_seq")
    con.commit()
    con.close()
    real = db.get_db
    alter_intentado = []

    class Cursor:
        def __init__(self, c):
            self.c = c

        def execute(self, sql, *args):
            if sql.startswith("PRAGMA table_info(users)"):
                filas = [{"name": r["name"]} for r in self.c.execute(sql)]
                otra = sqlite3.connect(db.DB_PATH)
                otra.execute("ALTER TABLE users ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0")
                otra.commit()
                otra.close()
                return iter(filas)
            if sql.startswith("ALTER TABLE users"):
                alter_intentado.append(sql)
            return self.c.execute(sql, *args)

        def __getattr__(self, nombre):
            return getattr(self.c, nombre)

    class Conexion:
        def __init__(self):
            self.conn = real()

        def cursor(self):
            return Cursor(self.conn.cursor())

        def __getattr__(self, nombre):
            return getattr(self.conn, nombre)

    monkeypatch.setattr(db, "get_db", Conexion)
    db.init_db()
    assert alter_intentado, "la carrera no se ha reproducido"
    columnas = {r[1] for r in sqlite3.connect(db.DB_PATH).execute("PRAGMA table_info(users)")}
    assert "sync_seq" in columnas


# ========================================
# La portada elegida de una lista (plan 24, P11)
# ========================================

def test_an_old_playlists_table_gets_the_cover_column(db, tmp_path):
    vieja = tmp_path / "listas-viejas.db"
    con = sqlite3.connect(vieja)
    con.execute("CREATE TABLE playlists (user_id INTEGER NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', "
                "songs TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, seq INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, "
                "deleted_at TEXT, PRIMARY KEY (user_id, id))")
    con.execute("INSERT INTO playlists (user_id, id, name, created_at, seq) VALUES (1, 'l1', 'Antes', '2026-09-01', 1)")
    con.commit()
    con.close()
    db.DB_PATH = str(vieja)
    db.init_db()
    con = sqlite3.connect(vieja)
    assert con.execute("SELECT name, portada FROM playlists").fetchall() == [("Antes", "")]


def test_the_chosen_cover_travels_only_if_it_is_one_of_its_songs(authed_client):
    def poner(lid, portada):
        return {"tipo": "lista", "accion": "poner", "datos": {
            "id": lid, "name": lid, "songs": ["aaaaaaaaaaa", "bbbbbbbbbbb"], "portada": portada}}
    r = enviar(authed_client, [poner("con", "bbbbbbbbbbb"), poner("fuera", "ccccccccccc"),
                               poner("rara", 42), poner("sin", "")])
    assert r.status_code == 200, "una portada que no vale no rechaza la lista"
    portadas = {pl["id"]: pl["portada"] for pl in authed_client.get("/api/sync?desde=0").get_json()["listas"]}
    assert portadas == {"con": "bbbbbbbbbbb", "fuera": "", "rara": "", "sin": ""}
