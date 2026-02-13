"""
SQLite Database Module for YouTube Music Downloader
Handles user accounts, download history, and favorites persistence.
"""

import os
import sqlite3
from datetime import datetime

# Database file location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, 'data')
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

        CREATE INDEX IF NOT EXISTS idx_history_user ON download_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
        CREATE INDEX IF NOT EXISTS idx_history_video ON download_history(user_id, video_id);
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
            (datetime.utcnow().isoformat(), name, picture, user['id'])
        )
        conn.commit()
        user_id = user['id']
    else:
        # Create new user
        now = datetime.utcnow().isoformat()
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
            video_data.get('downloadedAt', datetime.utcnow().isoformat())
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
                video_data.get('addedAt', datetime.utcnow().isoformat())
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
                    item.get('downloadedAt', datetime.utcnow().isoformat())
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
                    item.get('addedAt', datetime.utcnow().isoformat())
                )
            )
        except sqlite3.IntegrityError:
            continue
    
    conn.commit()
    conn.close()
