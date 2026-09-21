"""
SQLite Database Module for YouTube Music Downloader
Handles user accounts, download history, and favorites persistence.
"""

import os
import sqlite3
from datetime import datetime, timezone

# Database file location.
# YTDL_DATA_DIR permite sacar la base de datos del directorio del sitio web
# (plan 02, T0c). En producción debe apuntar fuera de él: aunque Flask ya no
# publica el directorio, así un error de configuración futuro no vuelve a
# exponer los datos de los usuarios.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('YTDL_DATA_DIR', os.path.join(SCRIPT_DIR, 'data'))
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
    ''')
    
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
