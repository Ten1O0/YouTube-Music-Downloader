"""
SQLite Database Module for YouTube Music Downloader
Handles user accounts, download history, and favorites persistence.
"""

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone

# Database file location.
# YTDL_DATA_DIR permite sacar la base de datos del directorio del sitio web
# (plan 02, T0c). En producción debe apuntar fuera de él: aunque Flask ya no
# publica el directorio, así un error de configuración futuro no vuelve a
# exponer los datos de los usuarios.
# Sin la variable, data/ en la raíz del proyecto (database.py está en backend/)
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get('YTDL_DATA_DIR', os.path.join(RAIZ, 'data'))
DB_PATH = os.path.join(DATA_DIR, 'youtube_downloader.db')


def get_db():
    """Get a database connection with row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent access
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialize database tables if they don't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            picture TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_login TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS download_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT 'Sin título',
            thumbnail TEXT DEFAULT '',
            channel TEXT DEFAULT '',
            url TEXT NOT NULL,
            downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT 'Sin título',
            thumbnail TEXT DEFAULT '',
            channel TEXT DEFAULT '',
            url TEXT NOT NULL,
            duration INTEGER DEFAULT 0,
            added_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, video_id)
        );

        -- Registro de TODAS las descargas, con sesión iniciada o sin ella.
        -- download_history solo recoge las de usuarios autenticados, que son
        -- una minoría: esta tabla existe para saber si la aplicación tiene uso
        -- real. No guarda IP ni user-agent, solo qué se descargó y cuándo.
        CREATE TABLE IF NOT EXISTS download_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            download_id TEXT NOT NULL,
            video_id TEXT DEFAULT '',
            title TEXT DEFAULT '',
            content_type TEXT DEFAULT '',
            total_items INTEGER DEFAULT 1,
            user_id INTEGER,
            status TEXT NOT NULL DEFAULT 'started',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_history_user ON download_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
        CREATE INDEX IF NOT EXISTS idx_history_video ON download_history(user_id, video_id);
        CREATE INDEX IF NOT EXISTS idx_events_created ON download_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_events_download ON download_events(download_id);

        -- Sincronización (plan 13): la biblioteca, las listas y los ajustes de
        -- cada cuenta, con el número de secuencia del cambio que tocó cada fila.
        -- Borrar no elimina la fila: la marca (lápida) para que los demás
        -- dispositivos se enteren. El audio no viaja.
        CREATE TABLE IF NOT EXISTS library_items (
            user_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            channel TEXT DEFAULT '',
            artist TEXT DEFAULT '',
            track TEXT DEFAULT '',
            extra TEXT DEFAULT '',
            editado INTEGER NOT NULL DEFAULT 0,
            duration INTEGER DEFAULT 0,
            added_at TEXT NOT NULL,
            seq INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            PRIMARY KEY (user_id, video_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS playlists (
            user_id INTEGER NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            songs TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            seq INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            PRIMARY KEY (user_id, id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Una fila por escucha. La clave (dispositivo, id local) hace que un
        -- reenvío no la duplique. Artista y canción van copiados: si la canción
        -- se borra, el resumen del año (plan 17) sigue sabiendo qué era.
        CREATE TABLE IF NOT EXISTS listens (
            user_id INTEGER NOT NULL,
            device TEXT NOT NULL,
            local_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            artist TEXT DEFAULT '',
            track TEXT DEFAULT '',
            t INTEGER NOT NULL,
            seconds INTEGER NOT NULL,
            PRIMARY KEY (user_id, device, local_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL DEFAULT '{}',
            seq INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_library_seq ON library_items(user_id, seq);
        CREATE INDEX IF NOT EXISTS idx_playlists_seq ON playlists(user_id, seq);
        CREATE INDEX IF NOT EXISTS idx_listens_t ON listens(user_id, t);
    ''')

    # SQLite no tiene ADD COLUMN IF NOT EXISTS: se mira antes
    columnas = {fila['name'] for fila in cursor.execute('PRAGMA table_info(users)')}
    if 'sync_seq' not in columnas:
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError as e:
            # Otro proceso que arrancaba a la vez ya la añadió
            if 'duplicate column' not in str(e).lower():
                raise

    conn.commit()
    conn.close()
    print(f"[DB] Database initialized at {DB_PATH}")


# ========================================
# User Operations
# ========================================

def get_or_create_user(email, name='', picture=''):
    """Find existing user or create new one. Returns user dict."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Try to find existing user
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    if user:
        # Update last login and profile info
        cursor.execute(
            'UPDATE users SET last_login = ?, name = ?, picture = ? WHERE id = ?',
            (datetime.now(timezone.utc).isoformat(), name, picture, user['id'])
        )
        conn.commit()
        user_id = user['id']
    else:
        # Create new user
        now = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            'INSERT INTO users (email, name, picture, created_at, last_login) VALUES (?, ?, ?, ?, ?)',
            (email, name, picture, now, now)
        )
        conn.commit()
        user_id = cursor.lastrowid
    
    # Fetch fresh user data
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    
    return dict(user)


def get_user_by_id(user_id):
    """Get user by ID. Returns user dict or None."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    return dict(user) if user else None


# ========================================
# Download History Operations
# ========================================

def add_history(user_id, video_data):
    """Add a download to user's history. Replaces duplicate video_id."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Remove existing entry for same video (to move it to top)
    cursor.execute(
        'DELETE FROM download_history WHERE user_id = ? AND video_id = ?',
        (user_id, video_data.get('id', ''))
    )
    
    cursor.execute(
        '''INSERT INTO download_history (user_id, video_id, title, thumbnail, channel, url, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (
            user_id,
            video_data.get('id', ''),
            video_data.get('title', 'Sin título'),
            video_data.get('thumbnail', ''),
            video_data.get('channel', ''),
            video_data.get('url', ''),
            video_data.get('downloadedAt', datetime.now(timezone.utc).isoformat())
        )
    )
    
    # Keep only last 1000 items per user
    cursor.execute('''
        DELETE FROM download_history WHERE user_id = ? AND id NOT IN (
            SELECT id FROM download_history WHERE user_id = ?
            ORDER BY downloaded_at DESC LIMIT 1000
        )
    ''', (user_id, user_id))
    
    conn.commit()
    conn.close()


def get_history(user_id):
    """Get user's download history, newest first."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        '''SELECT video_id as id, title, thumbnail, channel, url, downloaded_at as downloadedAt
           FROM download_history WHERE user_id = ?
           ORDER BY downloaded_at DESC LIMIT 1000''',
        (user_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def clear_history(user_id):
    """Clear all download history for a user."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM download_history WHERE user_id = ?', (user_id,))
    conn.commit()
    conn.close()


# ========================================
# Favorites Operations
# ========================================

def add_favorite(user_id, video_data):
    """Add a video to user's favorites."""
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            '''INSERT OR REPLACE INTO favorites (user_id, video_id, title, thumbnail, channel, url, duration, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                user_id,
                video_data.get('id', ''),
                video_data.get('title', 'Sin título'),
                video_data.get('thumbnail', ''),
                video_data.get('channel', ''),
                video_data.get('url', ''),
                video_data.get('duration', 0),
                video_data.get('addedAt', datetime.now(timezone.utc).isoformat())
            )
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass  # Already favorited
    finally:
        conn.close()


def remove_favorite(user_id, video_id):
    """Remove a video from user's favorites."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        'DELETE FROM favorites WHERE user_id = ? AND video_id = ?',
        (user_id, video_id)
    )
    conn.commit()
    conn.close()


def get_favorites(user_id):
    """Get all favorites for a user, newest first."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        '''SELECT video_id as id, title, thumbnail, channel, url, duration, added_at as addedAt
           FROM favorites WHERE user_id = ?
           ORDER BY added_at DESC''',
        (user_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def is_favorite(user_id, video_id):
    """Check if a video is in user's favorites."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT 1 FROM favorites WHERE user_id = ? AND video_id = ?',
        (user_id, video_id)
    )
    result = cursor.fetchone()
    conn.close()
    return result is not None


def sync_user_data(user_id, history_items, favorite_items):
    """Bulk sync localStorage data to server on first login.
    Only adds items that don't already exist."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Sync history
    for item in (history_items or []):
        video_id = item.get('id', '')
        if not video_id:
            continue
        # Check if already exists
        cursor.execute(
            'SELECT 1 FROM download_history WHERE user_id = ? AND video_id = ?',
            (user_id, video_id)
        )
        if not cursor.fetchone():
            cursor.execute(
                '''INSERT INTO download_history (user_id, video_id, title, thumbnail, channel, url, downloaded_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (
                    user_id, video_id,
                    item.get('title', ''),
                    item.get('thumbnail', ''),
                    item.get('channel', ''),
                    item.get('url', ''),
                    item.get('downloadedAt', datetime.now(timezone.utc).isoformat())
                )
            )
    
    # Sync favorites
    for item in (favorite_items or []):
        video_id = item.get('id', '')
        if not video_id:
            continue
        try:
            cursor.execute(
                '''INSERT OR IGNORE INTO favorites (user_id, video_id, title, thumbnail, channel, url, duration, added_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    user_id, video_id,
                    item.get('title', ''),
                    item.get('thumbnail', ''),
                    item.get('channel', ''),
                    item.get('url', ''),
                    item.get('duration', 0),
                    item.get('addedAt', datetime.now(timezone.utc).isoformat())
                )
            )
        except sqlite3.IntegrityError:
            continue
    
    conn.commit()
    conn.close()


# ========================================
# Download Events (analítica de uso)
# ========================================
#
# download_history solo registra descargas de usuarios autenticados, que son
# una minoría. Estas funciones registran TODAS, con sesión o sin ella, para
# poder responder a "¿tiene esto uso real y qué se descarga?".
#
# Deliberadamente NO se guarda IP ni user-agent: para contar uso y ver títulos
# no hacen falta, y guardarlos convertiría esto en datos personales.

def log_download_started(download_id, video_id='', title='', content_type='',
                         total_items=1, user_id=None):
    """Registra el inicio de una descarga. Nunca debe hacer fallar la descarga."""
    try:
        conn = get_db()
        conn.execute(
            '''INSERT INTO download_events
               (download_id, video_id, title, content_type, total_items, user_id, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'started', ?)''',
            (
                download_id,
                video_id or '',
                title or '',
                content_type or '',
                total_items or 1,
                user_id,
                datetime.now(timezone.utc).isoformat(),
            )
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.Error as e:
        print(f"[DB] No se pudo registrar el inicio de descarga: {e}")
        return False


def complete_download_event(download_id, status='complete', title=None):
    """Marca una descarga como terminada (o fallida) y completa el título."""
    try:
        conn = get_db()
        if title:
            conn.execute(
                '''UPDATE download_events
                   SET status = ?, completed_at = ?, title = CASE WHEN title = '' THEN ? ELSE title END
                   WHERE download_id = ?''',
                (status, datetime.now(timezone.utc).isoformat(), title, download_id)
            )
        else:
            conn.execute(
                'UPDATE download_events SET status = ?, completed_at = ? WHERE download_id = ?',
                (status, datetime.now(timezone.utc).isoformat(), download_id)
            )
        conn.commit()
        conn.close()
        return True
    except sqlite3.Error as e:
        print(f"[DB] No se pudo cerrar el evento de descarga: {e}")
        return False


def get_download_stats(days=30):
    """Resumen de uso de los últimos `days` días."""
    conn = get_db()
    cur = conn.cursor()
    desde = f"-{int(days)} days"

    total = cur.execute(
        "SELECT COUNT(*) FROM download_events WHERE created_at >= datetime('now', ?)",
        (desde,)
    ).fetchone()[0]

    completadas = cur.execute(
        "SELECT COUNT(*) FROM download_events WHERE status = 'complete' AND created_at >= datetime('now', ?)",
        (desde,)
    ).fetchone()[0]

    anonimas = cur.execute(
        "SELECT COUNT(*) FROM download_events WHERE user_id IS NULL AND created_at >= datetime('now', ?)",
        (desde,)
    ).fetchone()[0]

    por_dia = [dict(r) for r in cur.execute(
        """SELECT date(created_at) AS dia, COUNT(*) AS descargas
           FROM download_events WHERE created_at >= datetime('now', ?)
           GROUP BY dia ORDER BY dia DESC""",
        (desde,)
    ).fetchall()]

    top = [dict(r) for r in cur.execute(
        """SELECT title, COUNT(*) AS veces
           FROM download_events
           WHERE title != '' AND created_at >= datetime('now', ?)
           GROUP BY title ORDER BY veces DESC LIMIT 20""",
        (desde,)
    ).fetchall()]

    conn.close()
    return {
        'dias': days,
        'total': total,
        'completadas': completadas,
        'anonimas': anonimas,
        'autenticadas': total - anonimas,
        'por_dia': por_dia,
        'mas_descargadas': top,
    }


def get_recent_downloads(limit=50):
    """Últimas descargas registradas, de cualquier usuario o anónimas."""
    conn = get_db()
    rows = conn.execute(
        '''SELECT download_id, video_id, title, content_type, total_items,
                  user_id, status, created_at, completed_at
           FROM download_events ORDER BY created_at DESC LIMIT ?''',
        (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ========================================
# Sincronización de la cuenta (plan 13)
# ========================================
#
# Cada cambio aceptado incrementa users.sync_seq y deja ese número en la fila
# que tocó. Un dispositivo pide «lo cambiado desde N» y recibe las filas con
# seq > N, lápidas incluidas. Gana el último cambio que llega al servidor,
# registro a registro. Los datos llegan ya validados por server.py.

MAX_CANCIONES_CUENTA = 10_000
MAX_LISTAS_CUENTA = 200
DIAS_PAPELERA = 30
DIAS_LAPIDAS = 90


class LimiteSuperado(Exception):
    """Aplicar los cambios dejaría la cuenta por encima de sus límites."""


def _ahora():
    return datetime.now(timezone.utc).isoformat()


def _conexion_transaccion():
    """Conexión en modo manual: BEGIN IMMEDIATE bloquea a otro escritor desde el principio."""
    conn = get_db()
    conn.isolation_level = None
    conn.execute('BEGIN IMMEDIATE')
    return conn


def aplicar_cambios(user_id, cambios):
    """
    Aplica los cambios en una sola transacción: o todos o ninguno. Devuelve el
    número de secuencia final de la cuenta.

    cambios: [{'tipo': 'cancion'|'lista'|'ajustes', 'accion': 'poner'|'borrar', 'datos': {...}}]
    """
    conn = _conexion_transaccion()
    try:
        seq = conn.execute('SELECT sync_seq FROM users WHERE id = ?', (user_id,)).fetchone()['sync_seq']
        ahora = _ahora()
        for cambio in cambios:
            seq += 1
            tipo, accion, d = cambio['tipo'], cambio['accion'], cambio['datos']
            if tipo == 'cancion' and accion == 'poner':
                conn.execute(
                    '''INSERT INTO library_items (user_id, video_id, title, channel, artist, track, extra,
                                                   editado, duration, added_at, seq, deleted, deleted_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
                       ON CONFLICT(user_id, video_id) DO UPDATE SET
                           title = excluded.title, channel = excluded.channel, artist = excluded.artist,
                           track = excluded.track, extra = excluded.extra, editado = excluded.editado,
                           duration = excluded.duration, seq = excluded.seq, deleted = 0, deleted_at = NULL''',
                    (user_id, d['video_id'], d['title'], d['channel'], d['artist'], d['track'], d['extra'],
                     int(d['editado']), d['duration'], d['added_at'], seq))
            elif tipo == 'cancion':
                conn.execute(
                    '''UPDATE library_items SET deleted = 1, deleted_at = ?, seq = ?
                       WHERE user_id = ? AND video_id = ? AND deleted = 0''',
                    (ahora, seq, user_id, d['video_id']))
            elif tipo == 'lista' and accion == 'poner':
                conn.execute(
                    '''INSERT INTO playlists (user_id, id, name, description, songs, created_at, seq, deleted, deleted_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
                       ON CONFLICT(user_id, id) DO UPDATE SET
                           name = excluded.name, description = excluded.description, songs = excluded.songs,
                           seq = excluded.seq, deleted = 0, deleted_at = NULL''',
                    (user_id, d['id'], d['name'], d['description'], json.dumps(d['songs']), d['created_at'], seq))
            elif tipo == 'lista':
                conn.execute(
                    '''UPDATE playlists SET deleted = 1, deleted_at = ?, seq = ?
                       WHERE user_id = ? AND id = ? AND deleted = 0''',
                    (ahora, seq, user_id, d['id']))
            elif tipo == 'ajustes':
                conn.execute(
                    '''INSERT INTO user_settings (user_id, data, seq) VALUES (?, ?, ?)
                       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, seq = excluded.seq''',
                    (user_id, json.dumps(d), seq))

        canciones = conn.execute('SELECT COUNT(*) FROM library_items WHERE user_id = ? AND deleted = 0', (user_id,)).fetchone()[0]
        listas = conn.execute('SELECT COUNT(*) FROM playlists WHERE user_id = ? AND deleted = 0', (user_id,)).fetchone()[0]
        if canciones > MAX_CANCIONES_CUENTA or listas > MAX_LISTAS_CUENTA:
            raise LimiteSuperado(f'{canciones} canciones y {listas} listas')

        conn.execute('UPDATE users SET sync_seq = ? WHERE id = ?', (seq, user_id))
        conn.execute('COMMIT')
        return seq
    except BaseException:
        conn.execute('ROLLBACK')
        raise
    finally:
        conn.close()


def _cancion_de_fila(fila):
    return {
        'videoId': fila['video_id'], 'title': fila['title'], 'channel': fila['channel'],
        'artist': fila['artist'], 'track': fila['track'], 'extra': fila['extra'],
        'editado': bool(fila['editado']), 'duration': fila['duration'], 'addedAt': fila['added_at'],
        'seq': fila['seq'], 'deleted': bool(fila['deleted']),
    }


def cambios_desde(user_id, desde):
    """Lo que ha cambiado en la cuenta desde el número de secuencia `desde`."""
    conn = get_db()
    try:
        seq = conn.execute('SELECT sync_seq FROM users WHERE id = ?', (user_id,)).fetchone()['sync_seq']
        biblioteca = [_cancion_de_fila(f) for f in conn.execute(
            'SELECT * FROM library_items WHERE user_id = ? AND seq > ? ORDER BY seq', (user_id, desde))]
        listas = [{
            'id': f['id'], 'name': f['name'], 'description': f['description'],
            'songs': json.loads(f['songs']), 'createdAt': f['created_at'],
            'seq': f['seq'], 'deleted': bool(f['deleted']),
        } for f in conn.execute('SELECT * FROM playlists WHERE user_id = ? AND seq > ? ORDER BY seq', (user_id, desde))]
        fila = conn.execute('SELECT data, seq FROM user_settings WHERE user_id = ? AND seq > ?', (user_id, desde)).fetchone()
        return {'seq': seq, 'biblioteca': biblioteca, 'listas': listas, 'ajustes': json.loads(fila['data']) if fila else None}
    finally:
        conn.close()


def registrar_escuchas(user_id, dispositivo, escuchas):
    """
    Guarda las escuchas de un dispositivo. Reenviar una no la duplica; si
    llega otra vez con más segundos (la reproducción siguió), se quedan los más.
    """
    conn = get_db()
    try:
        conn.executemany(
            '''INSERT INTO listens (user_id, device, local_id, video_id, artist, track, t, seconds)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, device, local_id) DO UPDATE SET seconds = MAX(seconds, excluded.seconds)''',
            [(user_id, dispositivo, e['id'], e['video_id'], e['artist'], e['track'], e['t'], e['seconds']) for e in escuchas])
        conn.commit()
    finally:
        conn.close()


def eliminadas_recientes(user_id, dias=DIAS_PAPELERA):
    """Canciones borradas en los últimos `dias` días, las más recientes primero."""
    conn = get_db()
    try:
        desde = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
        return [_cancion_de_fila(f) | {'deletedAt': f['deleted_at']} for f in conn.execute(
            '''SELECT * FROM library_items WHERE user_id = ? AND deleted = 1 AND deleted_at >= ?
               ORDER BY deleted_at DESC LIMIT 500''', (user_id, desde))]
    finally:
        conn.close()


def restaurar(user_id, video_ids, dias=DIAS_PAPELERA):
    """Devuelve a la biblioteca canciones de la papelera. Devuelve el seq final."""
    conn = _conexion_transaccion()
    try:
        seq = conn.execute('SELECT sync_seq FROM users WHERE id = ?', (user_id,)).fetchone()['sync_seq']
        desde = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
        for video_id in video_ids:
            seq += 1
            conn.execute(
                '''UPDATE library_items SET deleted = 0, deleted_at = NULL, seq = ?
                   WHERE user_id = ? AND video_id = ? AND deleted = 1 AND deleted_at >= ?''',
                (seq, user_id, video_id, desde))
        conn.execute('UPDATE users SET sync_seq = ? WHERE id = ?', (seq, user_id))
        conn.execute('COMMIT')
        return seq
    except BaseException:
        conn.execute('ROLLBACK')
        raise
    finally:
        conn.close()


def purgar_lapidas(dias=DIAS_LAPIDAS):
    """Borra de verdad las lápidas de más de `dias` días. Devuelve cuántas."""
    conn = get_db()
    try:
        limite = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
        n = conn.execute('DELETE FROM library_items WHERE deleted = 1 AND deleted_at < ?', (limite,)).rowcount
        n += conn.execute('DELETE FROM playlists WHERE deleted = 1 AND deleted_at < ?', (limite,)).rowcount
        conn.commit()
        return n
    finally:
        conn.close()
