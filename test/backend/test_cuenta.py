"""
Privacidad (plan 21, T6): «Borrar mi cuenta» y el registro de descargas que
caduca a los 90 días, como dice la política de privacidad.
"""

import sqlite3
from datetime import datetime, timezone

TABLAS_DE_LA_CUENTA = ['download_history', 'favorites', 'library_items', 'playlists',
                       'listens', 'user_settings', 'followed_playlists', 'followed_items']


def sembrar(db, user):
    """Una cuenta con algo en cada tabla."""
    uid = user['id']
    db.add_history(uid, {'id': 'aaaaaaaaaaa', 'title': 'Tema', 'channel': 'Canal'})
    db.add_favorite(uid, {'id': 'aaaaaaaaaaa', 'title': 'Tema', 'channel': 'Canal'})
    db.aplicar_cambios(uid, [
        {'tipo': 'cancion', 'accion': 'poner', 'datos': {
            'video_id': 'aaaaaaaaaaa', 'title': 'Tema', 'channel': 'Canal', 'artist': 'A', 'track': 'T',
            'extra': '', 'editado': False, 'duration': 200, 'added_at': '2026-09-01T10:00:00+00:00'}},
        {'tipo': 'lista', 'accion': 'poner', 'datos': {
            'id': 'l1', 'name': 'Mi lista', 'description': '', 'songs': ['aaaaaaaaaaa'], 'created_at': '2026-09-01T10:00:00+00:00'}},
        {'tipo': 'ajustes', 'accion': 'poner', 'datos': {'fundido': 6}},
    ])
    t = int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp() * 1000)
    db.registrar_escuchas(uid, 'pruebas', [{'id': 1, 'video_id': 'aaaaaaaaaaa', 'artist': 'A', 'track': 'T', 't': t, 'seconds': 200}])
    db.seguir_lista(uid, 'PLaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Seguida', '17', True,
                    [{'video_id': 'bbbbbbbbbbb', 'title': 'Otra', 'channel': 'Canal', 'duration': 200}])
    db.log_download_started('d1', video_id='aaaaaaaaaaa', title='Tema', user_id=uid)


def filas(db, tabla, uid):
    conn = db.get_db()
    try:
        return conn.execute(f'SELECT COUNT(*) FROM {tabla} WHERE user_id = ?', (uid,)).fetchone()[0]  # noqa: S608 — nombre de tabla fijo
    finally:
        conn.close()


# ========================================
# borrar_cuenta
# ========================================

def test_borrar_la_cuenta_se_lleva_todo_lo_suyo(db, user):
    sembrar(db, user)
    for tabla in TABLAS_DE_LA_CUENTA + ['download_events']:
        assert filas(db, tabla, user['id']) > 0, f'la siembra no llegó a {tabla}'

    assert db.borrar_cuenta(user['id']) is True
    assert db.get_user_by_id(user['id']) is None
    for tabla in TABLAS_DE_LA_CUENTA + ['download_events']:
        assert filas(db, tabla, user['id']) == 0, f'quedan filas en {tabla}'


def test_no_toca_las_demas_cuentas(db, user, other_user):
    sembrar(db, user)
    sembrar(db, other_user)
    db.borrar_cuenta(user['id'])
    assert db.get_user_by_id(other_user['id']) is not None
    for tabla in TABLAS_DE_LA_CUENTA + ['download_events']:
        assert filas(db, tabla, other_user['id']) > 0, f'se llevó filas de otro en {tabla}'


def test_una_cuenta_que_no_existe(db):
    assert db.borrar_cuenta(999_999) is False


def test_cada_tabla_con_user_id_se_borra_con_la_cuenta(db):
    """Si mañana se añade una tabla con datos de la cuenta, tiene que irse con ella."""
    conn = db.get_db()
    try:
        tablas = [t for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        sin_cascada = []
        for tabla in tablas:
            columnas = {c[1] for c in conn.execute(f'PRAGMA table_info({tabla})')}
            if 'user_id' not in columnas or tabla == 'download_events':
                continue
            claves = [(fk[2], fk[6]) for fk in conn.execute(f'PRAGMA foreign_key_list({tabla})')]
            if ('users', 'CASCADE') not in claves:
                sin_cascada.append(tabla)
    finally:
        conn.close()
    assert sin_cascada == [], 'añádele ON DELETE CASCADE o bórrala en borrar_cuenta'


# ========================================
# purgar_eventos
# ========================================

def test_el_registro_de_descargas_caduca_a_los_90_dias(db, user):
    db.log_download_started('vieja', title='Vieja', user_id=user['id'])
    db.log_download_started('nueva', title='Nueva', user_id=user['id'])
    conn = db.get_db()
    try:
        conn.execute("UPDATE download_events SET created_at = datetime('now', '-91 days') WHERE download_id = 'vieja'")
        conn.execute("UPDATE download_events SET created_at = datetime('now', '-89 days') WHERE download_id = 'nueva'")
        conn.commit()
    finally:
        conn.close()

    assert db.purgar_eventos() == 1
    conn = db.get_db()
    try:
        assert [r[0] for r in conn.execute('SELECT download_id FROM download_events')] == ['nueva']
    finally:
        conn.close()


# ========================================
# La ruta
# ========================================

def test_la_ruta_borra_la_cuenta_y_el_token_deja_de_valer(authed_client, db, user):
    sembrar(db, user)
    r = authed_client.delete('/api/account')
    assert r.status_code == 200
    assert r.get_json() == {'ok': True}
    assert db.get_user_by_id(user['id']) is None
    # El mismo token ya no sirve para nada
    assert authed_client.get('/api/sync').status_code == 401
    assert authed_client.delete('/api/account').status_code == 401


def test_sin_sesion_no_se_borra_nada(client, db, user, monkeypatch, srv):
    monkeypatch.setattr(srv, 'db', db)
    assert client.delete('/api/account').status_code == 401
    assert db.get_user_by_id(user['id']) is not None


def test_con_get_no_se_borra(authed_client, db, user):
    assert authed_client.get('/api/account').status_code != 200
    assert db.get_user_by_id(user['id']) is not None


def test_las_claves_ajenas_estan_activas(db):
    conn = db.get_db()
    try:
        assert conn.execute('PRAGMA foreign_keys').fetchone()[0] == 1
    finally:
        conn.close()


def test_no_es_un_sqlite_sin_cascada():
    assert sqlite3.sqlite_version_info >= (3, 6, 19)
