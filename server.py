"""
YouTube Music Downloader - Flask Backend Server
Uses yt-dlp to download YouTube videos/playlists as MP3 files
With real-time progress updates via polling
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from werkzeug.utils import safe_join
import concurrent.futures
import jwt

# Google OAuth verification
try:
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests
    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False
    print("[WARNING] google-auth not installed. Google Sign-In will not work.")
    print("         Install with: pip install google-auth")

# Database module
import database as db

# ========================================
# Flask App Configuration
# ========================================
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, expose_headers=["Content-Disposition"])  # Enable CORS and expose headers for filename

# Thread Pool for Parallel Downloads
MAX_WORKERS = 5  # Parallel downloads (safe for M4A - no CPU-heavy conversion)
executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS)

# Configuration
DOWNLOAD_TIMEOUT = 1800  # 30 minutes timeout for large playlists
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'youtube_downloader')
AUDIO_EXTENSIONS = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
INVALID_DOWNLOAD_ID_ERROR = 'Invalid download ID'
NO_DATA_ERROR = 'No data provided'
MIMETYPE_AUDIO_MPEG = 'audio/mpeg'

# Google OAuth Configuration
GOOGLE_CLIENT_ID = '938078752300-e59ed4ln5bjeqeb8rfomfjtdtebqcckt.apps.googleusercontent.com'
JWT_SECRET = os.environ.get('JWT_SECRET', 'yt-music-downloader-secret-key-change-in-production')
JWT_EXPIRATION_HOURS = 24 * 30  # 30 days

# FFmpeg Configuration - Cross-platform support
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
IS_WINDOWS = sys.platform.startswith('win')

if IS_WINDOWS:
    FFMPEG_DIR = os.path.join(SCRIPT_DIR, 'ffmpeg-master-latest-win64-gpl', 'bin')
    FFMPEG_PATH = os.path.join(FFMPEG_DIR, 'ffmpeg.exe') if os.path.exists(FFMPEG_DIR) else 'ffmpeg'
    extra_paths = []
    if os.path.exists(FFMPEG_DIR):
        extra_paths.append(FFMPEG_DIR)
    if os.path.exists('C:\\Program Files\\nodejs'):
        extra_paths.append('C:\\Program Files\\nodejs')
    if extra_paths:
        os.environ['PATH'] = os.pathsep.join(extra_paths) + os.pathsep + os.environ.get('PATH', '')
else:
    # Linux: use system ffmpeg
    FFMPEG_PATH = '/usr/bin/ffmpeg'

# Store for download progress
download_progress = {}

# Store for cancellation tracking
download_cancellation = {}  # download_id -> threading.Event (set = cancelled)
download_processes = {}     # download_id -> subprocess.Popen object

# ========================================
# Utility Functions
# ========================================

def safe_download_path(download_id):
    """
    Validate download_id and return a safe path within TEMP_DIR.
    Prevents path traversal attacks (S2083).
    Returns the safe path or None if the download_id is invalid.
    """
    # download_id should be a short UUID (8 hex chars + hyphens)
    if not re.fullmatch(r'[a-f0-9\-]{1,36}', download_id):
        return None
    # Construct and resolve the path, then verify it's inside TEMP_DIR
    candidate = os.path.realpath(os.path.join(TEMP_DIR, download_id))
    if not candidate.startswith(os.path.realpath(TEMP_DIR) + os.sep):
        return None
    return candidate

def validate_youtube_url(url):
    """
    Validates if the given URL is a valid YouTube URL
    Returns the type of content (video, playlist, shorts) or None if invalid
    """
    # Check for playlist in watch URL first (video with playlist context)
    # Skip Radio/Mix playlists (RD...) as they are not downloadable
    if 'youtube.com/watch' in url and 'list=' in url:
        match = re.search(r'list=([a-zA-Z0-9_-]+)', url)
        if match:
            playlist_id = match.group(1)
            # Mix playlists start with 'RD' - treat as playlist now
            return 'playlist', playlist_id
    
    patterns = [
        (r'youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})', 'video'),
        (r'youtu\.be/([a-zA-Z0-9_-]{11})', 'video'),
        (r'youtube\.com/playlist\?list=([a-zA-Z0-9_-]+)', 'playlist'),
        (r'youtube\.com/shorts/([a-zA-Z0-9_-]{11})', 'shorts'),
        (r'music\.youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})', 'music'),
        (r'music\.youtube\.com/playlist\?list=([a-zA-Z0-9_-]+)', 'playlist'),
    ]
    
    for pattern, content_type in patterns:
        match = re.search(pattern, url)
        if match:
            return content_type, match.group(1)
    return None, None


def is_search_query(text):
    """Check if the input is a search query (not a URL)"""
    return not text.startswith('http://') and not text.startswith('https://')


def cleanup_temp_folder(folder_path):
    """Removes a temporary folder and all its contents"""
    try:
        if os.path.exists(folder_path):
            shutil.rmtree(folder_path)
    except Exception as e:
        app.logger.exception(f"Error cleaning up folder {folder_path}")


def create_zip_from_folder(folder_path, zip_name):
    """
    Creates a ZIP file from all audio files in the folder
    Returns the path to the ZIP file
    """
    import zipfile
    
    audio_extensions = AUDIO_EXTENSIONS
    audio_files = [f for f in os.listdir(folder_path) 
                   if f.lower().endswith(audio_extensions)]
    
    if not audio_files:
        return None
    
    zip_path = os.path.join(folder_path, f"{zip_name}.zip")
    
    # Use zipfile to create ZIP with only audio files
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for audio_file in audio_files:
            file_path = os.path.join(folder_path, audio_file)
            zipf.write(file_path, audio_file)  # Only include filename, not full path
    
    return zip_path


def count_downloaded_files(folder_path):
    """Count downloaded audio files in folder"""
    audio_extensions = AUDIO_EXTENSIONS
    if not os.path.exists(folder_path):
        return 0
    return len([f for f in os.listdir(folder_path) if f.lower().endswith(audio_extensions)])


def get_playlist_count(url):
    """Get the total number of videos in a playlist"""
    try:
        result = subprocess.run(
            [
                sys.executable, '-m', 'yt_dlp',
                '--flat-playlist',
                '--print', '%(playlist_count)s',
                '--playlist-items', '1',
                '--no-warnings',
                url
            ],
            capture_output=True,
            text=True,
            timeout=30,
            encoding='utf-8',
            errors='replace'
        )
        output = result.stdout.strip()
        # Get last line which should be the count
        lines = [l.strip() for l in output.split('\n') if l.strip().isdigit()]
        if lines:
            return int(lines[-1])
    except Exception as e:
        app.logger.exception("Error getting playlist count")
    return None


# ========================================
# API Routes
# ========================================

def parse_video_json_output(output):
    """Parse yt-dlp JSON output (one JSON object per line) into video info dicts."""
    videos = []
    for line in output.strip().split('\n'):
        if not line:
            continue
        try:
            video = json.loads(line)
            video_id = video.get('id', '')
            if video_id:
                videos.append({
                    'id': video_id,
                    'title': video.get('title', 'Sin título'),
                    'thumbnail': f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
                    'duration': video.get('duration', 0),
                    'channel': video.get('channel', video.get('uploader', 'Canal desconocido')),
                    'url': f"https://www.youtube.com/watch?v={video_id}"
                })
        except json.JSONDecodeError:
            continue
    return videos

@app.route('/', methods=['GET'])
def index():
    """Serve the frontend, prefer dist/ built by Vite"""
    for folder in ['dist', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'index.html')
        if os.path.exists(path):
            return send_file(path)
    return jsonify({'error': 'Frontend no compilado. Ejecuta npm run build'}), 404


@app.route('/download', methods=['GET'])
def download_page():
    """Serve the APK download landing page, prefer dist/ built by Vite"""
    for folder in ['dist', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'download.html')
        if os.path.exists(path):
            return send_file(path)
    return jsonify({'error': 'Página de descarga no encontrada'}), 404


@app.route('/sw.js', methods=['GET'])
def service_worker():
    """Serve the Service Worker with correct headers from public/ or dist/"""
    target_path = None
    for folder in ['dist', 'public', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'sw.js')
        if os.path.exists(path):
            target_path = path
            break

    if not target_path:
        return jsonify({'error': 'Service Worker no encontrado'}), 404

    response = send_file(target_path, mimetype='application/javascript')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@app.route('/manifest.json', methods=['GET'])
def serve_manifest():
    """Serve manifest.json with correct headers from public/ or dist/"""
    for folder in ['dist', 'public', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'manifest.json')
        if os.path.exists(path):
            return send_file(path, mimetype='application/json')
    return jsonify({'error': 'manifest.json no encontrado'}), 404


@app.route('/favicon.png', methods=['GET'])
def serve_favicon():
    """Serve favicon.png from public/ or dist/"""
    for folder in ['dist', 'public', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'favicon.png')
        if os.path.exists(path):
            return send_file(path, mimetype='image/png')
    return jsonify({'error': 'favicon.png no encontrado'}), 404


@app.route('/assets/<path:filename>', methods=['GET'])
def serve_assets(filename):
    """Serve static assets built by Vite inside dist/assets"""
    for folder in ['dist/assets', 'assets']:
        dir_path = os.path.join(SCRIPT_DIR, folder)
        try:
            file_path = safe_join(dir_path, filename)
            if file_path and os.path.exists(file_path) and os.path.isfile(file_path):
                return send_file(file_path)
        except ValueError:
            # safe_join raises ValueError if the path goes outside dir_path
            continue
    return jsonify({'error': 'Asset no encontrado'}), 404

@app.route('/api/stream/<download_id>', methods=['GET'])
def stream_file(download_id):
    """Streams a downloaded file to the web player with Range support."""
    try:
        # Prevent path traversal
        if '..' in download_id or '/' in download_id or '\\' in download_id:
            return jsonify({'error': 'Invalid ID'}), 400

        # Look for the audio file inside TEMP_DIR / download_id
        target_dir = Path(TEMP_DIR) / download_id
        files = []
        if target_dir.exists():
            files = [f for f in target_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]
        
        target_file = files[0] if files else None
        
        # If not found, return 404
        if not target_file:
             return jsonify({'error': 'File not found or expired'}), 404

        file_size = target_file.stat().st_size
        range_header = request.headers.get('Range', None)

        if not range_header:
            return send_file(target_file, mimetype=MIMETYPE_AUDIO_MPEG)
        
        # Parse range header
        byte1, byte2 = 0, None
        match = re.search(r'(\d+)-\s*(\d*)', range_header)
        if match:
            byte1 = int(match.group(1))
            if match.group(2):
                byte2 = int(match.group(2))

        length = file_size - byte1
        if byte2 is not None:
            length = byte2 + 1 - byte1

        with open(target_file, 'rb') as f:
            f.seek(byte1)
            data = f.read(length)

        rv = Response(data, 206, mimetype=MIMETYPE_AUDIO_MPEG, content_type=MIMETYPE_AUDIO_MPEG, direct_passthrough=True)
        rv.headers.add('Content-Range', f'bytes {byte1}-{byte1 + length - 1}/{file_size}')
        rv.headers.add('Accept-Ranges', 'bytes')
        return rv

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/manifest.json', methods=['GET'])
def pwa_manifest():
    """Serve the PWA manifest"""
    return send_file('manifest.json', mimetype='application/manifest+json')


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api/search', methods=['POST'])
def search_youtube():
    """Search YouTube for videos matching a query"""
    data = request.get_json()
    
    if not data or 'query' not in data:
        return jsonify({'error': 'No se proporcionó búsqueda'}), 400
    
    query = data['query'].strip()
    if not query or len(query) < 2:
        return jsonify({'error': 'La búsqueda debe tener al menos 2 caracteres'}), 400
    
    try:
        # Use yt-dlp to search YouTube
        result = subprocess.run(
            [
                sys.executable, '-m', 'yt_dlp',
                f'ytsearch20:{query}',  # Search for 20 results
                '--dump-json',
                '--flat-playlist',
                '--no-warnings',
                '--no-download',
            ],
            capture_output=True,
            text=True,
            timeout=30,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            app.logger.error(f"yt-dlp search error: {result.stderr}")
            return jsonify({'error': 'Error al buscar en YouTube'}), 500
        
        results = parse_video_json_output(result.stdout)
        
        if not results:
            return jsonify({'error': 'No se encontraron resultados'}), 404
        
        return jsonify({'results': results})
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'La búsqueda tardó demasiado'}), 504
    except Exception as e:
        app.logger.exception("Search error")
        return jsonify({'error': f'Error: {str(e)}'}), 500


def build_playlist_cmd(url, playlist_id):
    """Build the yt-dlp command for fetching playlist info."""
    is_mix = playlist_id.startswith('RD')
    playlist_url = url if is_mix else f"https://www.youtube.com/playlist?list={playlist_id}"

    cmd = [
        sys.executable, '-m', 'yt_dlp',
        playlist_url,
        '--dump-json',
        '--flat-playlist',
        '--no-warnings',
        '--no-download'
    ]

    if is_mix:
        cmd.extend(['--playlist-end', '35'])

    return cmd


@app.route('/api/playlist-info', methods=['POST'])
def get_playlist_info():
    """Get information about all videos in a playlist"""
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': 'No se proporcionó URL de playlist'}), 400
    
    url = data['url'].strip()
    
    match = re.search(r'list=([a-zA-Z0-9_-]+)', url)
    if not match:
        return jsonify({'error': 'URL de playlist no válida'}), 400
    
    cmd = build_playlist_cmd(url, match.group(1))

    try:

        # Use yt-dlp to get playlist info
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            app.logger.error(f"yt-dlp playlist error: {result.stderr}")
            return jsonify({'error': 'Error al obtener información de la playlist'}), 500
        
        videos = parse_video_json_output(result.stdout)
        
        if not videos:
            return jsonify({'error': 'No se encontraron videos en la playlist'}), 404
        
        return jsonify({
            'videos': videos,
            'total': len(videos)
        })
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'La consulta tardó demasiado'}), 504
    except Exception as e:
        app.logger.exception("Playlist info error")
        return jsonify({'error': f'Error: {str(e)}'}), 500


@app.route('/api/progress/<download_id>', methods=['GET'])
def get_progress(download_id):
    """Get current download progress"""
    if safe_download_path(download_id) is None:
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400
    if download_id in download_progress:
        progress = download_progress[download_id]
        if progress.get('status') == 'complete':
            app.logger.info(f"Returning complete status for {download_id}")
        return jsonify(progress)
    return jsonify({'status': 'unknown', 'message': 'Download not found'}), 404


@app.route('/api/cancel/<download_id>', methods=['POST'])
def cancel_download(download_id):
    """Cancel an active download"""
    download_folder = safe_download_path(download_id)
    if download_folder is None:
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400
    app.logger.info(f"Cancel request received for {download_id}")
    
    # Check if download exists
    if download_id not in download_progress:
        return jsonify({'error': 'Download not found'}), 404
    
    # Check if already completed or cancelled
    current_status = download_progress[download_id].get('status')
    if current_status in ['complete', 'cancelled']:
        return jsonify({'error': f'Download already {current_status}'}), 400
    
    # Set cancellation event
    if download_id in download_cancellation:
        download_cancellation[download_id].set()
    
    # Terminate subprocess if running
    if download_id in download_processes:
        proc = download_processes[download_id]
        try:
            if proc and proc.poll() is None:  # Process is still running
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()  # Force kill if terminate didn't work
                app.logger.info(f"Terminated process for {download_id}")
        except Exception as e:
            app.logger.exception("Error terminating process")
    
    # Update progress status
    download_progress[download_id] = {
        'status': 'cancelled',
        'current': 0,
        'total': download_progress[download_id].get('total', 0),
        'message': 'Descarga cancelada'
    }
    
    # Clean up temp folder
    cleanup_temp_folder(download_folder)
    
    # Clean up tracking dicts
    if download_id in download_cancellation:
        del download_cancellation[download_id]
    if download_id in download_processes:
        del download_processes[download_id]
    
    app.logger.info(f"Download {download_id} cancelled successfully")
    return jsonify({'status': 'cancelled', 'message': 'Download cancelled'})


def download_single_item(video_info, output_folder, audio_quality):
    """Download a single video as audio. Returns (success, title)."""
    try:
        url = video_info.get('url', '')
        title = video_info.get('title', 'video')
        
        cmd = [
            sys.executable, '-m', 'yt_dlp',
            '--no-check-certificates',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '-x',
            '--audio-format', 'm4a',
            '--audio-quality', '0',
            '--embed-thumbnail',
            '--add-metadata',
            '-o', '%(title)s.%(ext)s',
            '--ffmpeg-location', FFMPEG_PATH,
            '--no-warnings',
            '--ignore-errors',
            '--no-playlist', 
            url
        ]
        
        start_time = time.time()
        proc = subprocess.run(
            cmd,
            cwd=output_folder,
            capture_output=True,
            timeout=600,
            encoding='utf-8',
            errors='replace'
        )
        duration = time.time() - start_time
        print(f"[DEBUG] Download {url} took {duration:.2f}s")
        
        if proc.returncode == 0:
            print(f"[OK] Downloaded: {title}")
            return (True, title)

        print(f"[ERROR] Failed {title}: {proc.stderr}")
        return (False, None)
            
    except Exception as e:
        print(f"[ERROR] Exception {video_info.get('url', '')}: {e}")
        return (False, None)


def run_parallel_batch(videos, download_folder, quality, download_id, total_count):
    """Coordinate parallel batch download in a background thread."""
    try:
        completed_count = 0
        
        futures = []
        for video in videos:
            futures.append(executor.submit(download_single_item, video, download_folder, quality))
        
        for i, future in enumerate(concurrent.futures.as_completed(futures)):
            try:
                success, title = future.result()
                if success:
                    completed_count += 1
            except Exception as e:
                print(f"Task exception: {e}")
            
            current_done = i + 1
            percent = int((current_done / total_count) * 100)
            msg = f'Procesando: {current_done}/{total_count} ({percent}%)'
            
            download_progress[download_id] = {
                'status': 'downloading',
                'current': current_done,
                'total': total_count,
                'message': msg
            }
        
        was_cancelled = download_id in download_cancellation and download_cancellation[download_id].is_set()
        final_files_count = count_downloaded_files(download_folder)
        app.logger.info(f"Batch parallel download complete: {final_files_count} files, cancelled: {was_cancelled}")
        
        if final_files_count > 0 and not was_cancelled:
            if final_files_count > 1:
                download_progress[download_id]['message'] = 'Creando archivo ZIP...'
                
            download_progress[download_id] = {
                'status': 'complete',
                'current': final_files_count,
                'total': total_count,
                'message': f'¡Completado! {final_files_count} archivos descargados.'
            }
        else:
            download_progress[download_id] = {
                'status': 'error',
                'current': 0,
                'total': total_count,
                'message': 'No se pudo descargar ninguna canción (error general)'
            }
                
    except Exception as e:
        app.logger.exception("Batch parallel error")
        download_progress[download_id] = {
            'status': 'error',
            'current': 0,
            'total': total_count,
            'message': f'Error fatal: {str(e)}'
        }


@app.route('/api/start-batch-download', methods=['POST'])
def start_batch_download():
    """Start batch download for multiple videos from a playlist in parallel"""
    app.logger.info("Batch download requested")
    data = request.get_json()
    
    if not data or 'videos' not in data:
        return jsonify({'error': 'No se proporcionaron videos'}), 400
    
    videos = data['videos']
    if not videos or len(videos) == 0:
        return jsonify({'error': 'La lista de videos está vacía'}), 400
    
    quality = str(data.get('quality', '192'))
    
    # Create unique download ID
    download_id = str(uuid.uuid4())[:8]
    download_folder = os.path.join(TEMP_DIR, download_id)
    os.makedirs(download_folder, exist_ok=True)
    
    total_count = len(videos)
    
    download_progress[download_id] = {
        'status': 'starting',
        'current': 0,
        'total': total_count,
        'message': f'Iniciando descarga paralela de {total_count} canciones...'
    }
    
    download_cancellation[download_id] = threading.Event()
    
    coordinator_thread = threading.Thread(
        target=run_parallel_batch,
        args=(videos, download_folder, quality, download_id, total_count),
        daemon=True
    )
    coordinator_thread.start()
    
    return jsonify({
        'download_id': download_id,
        'total': total_count
    })


def get_playlist_count(url):
    try:
        cmd = [
            sys.executable, '-m', 'yt_dlp',
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            '--ignore-errors',
            url
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        
        if result.returncode == 0:
            try:
                data = json.loads(result.stdout)
                if 'entries' in data:
                    return len(data['entries'])
                return 1
            except (ValueError, KeyError):
                return 0
                
        app.logger.warning(f"Playlist count failed (code {result.returncode}): {result.stderr}")
        return 0
    except Exception as e:
        app.logger.exception("Error getting playlist count")
        return 0


def resolve_download_input(input_text):
    """Resolve input text into download parameters.
    Returns (search_query, content_type, content_id, total_count) or raises ValueError.
    """
    if is_search_query(input_text):
        return f"ytsearch:{input_text}", 'search', None, 1

    content_type, content_id = validate_youtube_url(input_text)
    if not content_type:
        raise ValueError('URL de YouTube no válida')

    if content_type != 'playlist':
        return input_text, content_type, content_id, 1

    if content_id.startswith('RD'):
        search_query = input_text
    else:
        search_query = f"https://www.youtube.com/playlist?list={content_id}"

    total_count = get_playlist_count(search_query) or 0
    return search_query, content_type, content_id, total_count


def prefetch_video_metadata(search_query, download_id):
    """Pre-fetch metadata for a single video and update progress."""
    try:
        meta_result = subprocess.run(
            [
                sys.executable, '-m', 'yt_dlp',
                '--dump-json', '--no-playlist', '--no-warnings',
                '--js-runtimes', 'node',
                '--remote-components', 'ejs:github',
                search_query
            ],
            capture_output=True, text=True, timeout=10,
            encoding='utf-8', errors='replace',
            env=os.environ
        )
        if meta_result.returncode == 0:
            video_meta = json.loads(meta_result.stdout)
            download_progress[download_id].update({
                'title': video_meta.get('title', 'Video'),
                'thumbnail': f"https://i.ytimg.com/vi/{video_meta.get('id')}/mqdefault.jpg"
            })
    except Exception as e:
        app.logger.warning(f"Could not fetch metadata: {e}")


def build_ytdlp_download_cmd(content_type, search_query):
    """Build the yt-dlp command list for downloading."""
    cmd = [
        sys.executable, '-m', 'yt_dlp',
        '--no-check-certificates',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        '-x',
        '--audio-format', 'm4a',
        '--audio-quality', '0',
        '--embed-thumbnail',
        '--add-metadata',
        '-o', '%(title)s.%(ext)s',
        '--ffmpeg-location', FFMPEG_PATH,
        '--ignore-errors',
        '--encoding', 'utf-8',
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--print', 'after_video:DOWNLOAD_LOG_TITLE:%(title)s',
    ]

    if content_type != 'playlist':
        cmd.append('--no-playlist')

    cmd.append(search_query)
    return cmd


def infer_title_from_folder(folder_path):
    """Try to infer a track title from files in the download folder."""
    try:
        for f in os.listdir(folder_path):
            if not f.endswith(('.mp3', '.m4a', '.webm', '.part', '.ytdl')):
                continue
            name = os.path.splitext(f)[0]
            while '.' in name:
                name = os.path.splitext(name)[0]
            if len(name) > 0 and name != 'download' and 'ytdlp' not in name:
                return name
    except OSError:
        pass
    return None


def monitor_download_files(stop_event, download_folder, download_id, total_count):
    """Background thread that monitors downloaded file count and infers titles."""
    while not stop_event.wait(timeout=1):
        current_count = count_downloaded_files(download_folder)
        current_title = infer_title_from_folder(download_folder)

        if download_id not in download_progress:
            continue

        update_data = {
            'status': 'downloading',
            'current': current_count,
            'total': total_count,
            'message': f'Descargando... {current_count} de {total_count} canciones'
        }

        if current_title:
            existing_title = download_progress[download_id].get('title')
            if not existing_title or existing_title == 'YouTube Video':
                update_data['title'] = current_title

        download_progress[download_id].update(update_data)


def parse_ytdlp_progress_line(line):
    """Parse a yt-dlp [download] progress line into (percent_str, speed_str, eta_str)."""
    parts = line.split()
    percent_str = next((p for p in parts if '%' in p), '0%')

    eta_str = ""
    if 'ETA' in line:
        try:
            eta_idx = parts.index('ETA')
            if eta_idx + 1 < len(parts):
                eta_str = parts[eta_idx + 1]
        except (ValueError, IndexError):
            pass

    speed_str = ""
    if 'at' in line:
        try:
            at_idx = parts.index('at')
            if at_idx + 1 < len(parts):
                speed_str = parts[at_idx + 1]
        except (ValueError, IndexError):
            pass

    return percent_str, speed_str, eta_str


def is_download_cancelled(download_id):
    """Check if a download has been cancelled."""
    return download_id in download_cancellation and download_cancellation[download_id].is_set()


def format_download_status(percent_str, speed_str, eta_str):
    """Build the status message string from progress components."""
    status_msg = f"Descargando: {percent_str}"
    if speed_str:
        status_msg += f" ({speed_str})"
    if eta_str:
        status_msg += f" - ETA: {eta_str}"
    return status_msg


def is_progress_line(line):
    """Check if a yt-dlp output line contains download progress info."""
    return '[download]' in line and '%' in line


def update_download_progress(download_id, line):
    """Parse a yt-dlp progress line and update download_progress dict safely."""
    try:
        percent_str, speed_str, eta_str = parse_ytdlp_progress_line(line)
        if download_id in download_progress:
            download_progress[download_id]['message'] = format_download_status(percent_str, speed_str, eta_str)
            download_progress[download_id]['percent'] = percent_str
    except Exception:
        pass


def process_ytdlp_output(proc, download_id):
    """Read yt-dlp stdout and update download progress in real time."""
    output_lines = []
    while True:
        if is_download_cancelled(download_id):
            proc.terminate()
            break

        line = proc.stdout.readline()
        if not line and proc.poll() is not None:
            break

        line = line.strip()
        if not line:
            continue

        output_lines.append(line)

        if line.startswith('DOWNLOAD_LOG_TITLE:'):
            continue

        if is_progress_line(line):
            update_download_progress(download_id, line)
            
    return output_lines


def finalize_download_status(download_id, proc, download_folder, total_count):
    """Set the final progress status after yt-dlp exits."""
    if is_download_cancelled(download_id):
        app.logger.info(f"Download {download_id} cancelled")
        return

    time.sleep(1)
    final_count = count_downloaded_files(download_folder)

    if final_count > 0:
        final_status = 'complete'
        final_msg = f'¡{final_count} canciones descargadas!'
    else:
        final_status = 'error'
        final_msg = 'No se pudo descargar ninguna canción'
        if proc.returncode != 0:
            final_msg += f" (Código {proc.returncode})"

    if download_id in download_progress:
        download_progress[download_id].update({
            'status': final_status,
            'current': final_count,
            'total': total_count if total_count > 0 else final_count,
            'message': final_msg
        })


def run_download_task(download_id, content_type, search_query, total_count):
    """Background task: build command, launch yt-dlp, monitor, and finalize."""
    download_folder = os.path.join(TEMP_DIR, download_id)

    try:
        cmd = build_ytdlp_download_cmd(content_type, search_query)
        app.logger.info(f"Running command: {' '.join(cmd[:5])}...")

        stop_monitor = threading.Event()
        monitor_thread = threading.Thread(
            target=monitor_download_files,
            args=(stop_monitor, download_folder, download_id, total_count),
            daemon=True
        )
        monitor_thread.start()

        proc = subprocess.Popen(
            cmd,
            cwd=download_folder,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            encoding='utf-8',
            errors='replace',
            env=os.environ,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )

        download_processes[download_id] = proc

        output_lines = process_ytdlp_output(proc, download_id)
        proc.wait()

        stop_monitor.set()
        monitor_thread.join(timeout=5)

        app.logger.info(f"yt-dlp finished with code {proc.returncode}")
        if proc.returncode != 0:
            app.logger.error(f"yt-dlp error output for {download_id}:")
            for out_line in output_lines[-20:]:
                app.logger.error(f"  [yt-dlp] {out_line}")

        finalize_download_status(download_id, proc, download_folder, total_count)

    except Exception as e:
        app.logger.exception("Download error")
        if download_id in download_progress:
            download_progress[download_id].update({
                'status': 'error',
                'message': f"Error interno: {str(e)}"
            })
    finally:
        if download_id in download_processes:
            del download_processes[download_id]


@app.route('/api/start-download', methods=['POST'])
def start_download():
    """Start download and return download_id for progress tracking"""
    data = request.get_json()

    if not data or 'url' not in data:
        return jsonify({'error': 'No se proporcionó URL o búsqueda'}), 400

    input_text = data['url'].strip()
    if not input_text:
        return jsonify({'error': 'El campo está vacío'}), 400

    try:
        search_query, content_type, content_id, total_count = resolve_download_input(input_text)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    quality = str(data.get('quality', '192'))

    download_id = str(uuid.uuid4())[:8]
    download_folder = os.path.join(TEMP_DIR, download_id)
    os.makedirs(download_folder, exist_ok=True)

    download_progress[download_id] = {
        'status': 'starting',
        'current': 0,
        'total': total_count,
        'message': 'Iniciando descarga...',
        'video_id': content_id if content_type == 'video' else None
    }

    download_cancellation[download_id] = threading.Event()

    if content_type == 'video':
        prefetch_video_metadata(search_query, download_id)

    executor.submit(run_download_task, download_id, content_type, search_query, total_count)

    return jsonify({
        'download_id': download_id,
        'total': total_count,
        'title': download_progress[download_id].get('title'),
        'thumbnail': download_progress[download_id].get('thumbnail')
    })


@app.route('/api/download/<download_id>', methods=['GET'])
def get_download(download_id):
    """Get the downloaded files for a completed download"""
    download_folder = safe_download_path(download_id)
    if download_folder is None:
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400
    app.logger.info(f"Download request received for {download_id}")
    
    if not os.path.exists(download_folder):
        app.logger.error(f"Download folder not found: {download_folder}")
        return jsonify({'error': 'Descarga no encontrada'}), 404
    
    audio_extensions = AUDIO_EXTENSIONS
    downloaded_files = [f for f in os.listdir(download_folder) 
                       if f.lower().endswith(audio_extensions)]
    app.logger.info(f"Found {len(downloaded_files)} audio files")
    
    if not downloaded_files:
        cleanup_temp_folder(download_folder)
        return jsonify({'error': 'No hay archivos para descargar'}), 404
    
    # If only one file, send it directly
    if len(downloaded_files) == 1:
        filename = downloaded_files[0]
        file_path = os.path.join(download_folder, filename)
        
        # Determine mimetype
        mimetype = 'audio/mpeg'
        if filename.lower().endswith('.m4a'):
            mimetype = 'audio/mp4'
        elif filename.lower().endswith('.wav'):
            mimetype = 'audio/wav'
            
        app.logger.info(f"Sending single file: {file_path} as {mimetype}")
        response = send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=True,
            download_name=filename
        )
        
        @response.call_on_close
        def cleanup():
            cleanup_temp_folder(download_folder)
            if download_id in download_progress:
                del download_progress[download_id]
        
        return response
    
    # Multiple files - create ZIP
    app.logger.info(f"Creating ZIP for {len(downloaded_files)} files...")
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_name = f"youtube_playlist_{timestamp}"
    
    try:
        zip_path = create_zip_from_folder(download_folder, zip_name)
        app.logger.info(f"ZIP created at: {zip_path}")
    except Exception as e:
        app.logger.exception("Error creating ZIP")
        cleanup_temp_folder(download_folder)
        return jsonify({'error': f'Error al crear ZIP: {str(e)}'}), 500
    
    if not zip_path or not os.path.exists(zip_path):
        app.logger.error(f"ZIP file not found at {zip_path}")
        cleanup_temp_folder(download_folder)
        return jsonify({'error': 'Error al crear el archivo ZIP'}), 500
    
    zip_size = os.path.getsize(zip_path) / (1024 * 1024)  # MB
    app.logger.info(f"Sending ZIP file ({zip_size:.2f} MB)...")
    
    response = send_file(
        zip_path,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f"{zip_name}.zip"
    )
    
    @response.call_on_close
    def cleanup():
        cleanup_temp_folder(download_folder)
        if download_id in download_progress:
            del download_progress[download_id]
    
    app.logger.info("Response prepared, returning to client")
    return response


@app.route('/api/download/<download_id>', methods=['DELETE'])
def delete_download(download_id):
    """Delete a downloaded file physically from the server"""
    download_folder = safe_download_path(download_id)
    if not download_folder:
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400
        
    if os.path.exists(download_folder):
        try:
            shutil.rmtree(download_folder)
            app.logger.info(f"Physically deleted: {download_folder}")
        except Exception as e:
            app.logger.exception(f"Error deleting folder {download_folder}")
            return jsonify({'error': 'No se pudo eliminar el archivo'}), 500
            
    return jsonify({'message': 'Eliminado correctamente'})


# ========================================
# Auth Helpers
# ========================================

def create_jwt_token(user_id):
    """Create a JWT token for a user session."""
    payload = {
        'user_id': user_id,
        'exp': datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        'iat': datetime.now(timezone.utc)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def get_current_user():
    """Extract user from Authorization header. Returns user dict or None."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.split(' ', 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user = db.get_user_by_id(payload['user_id'])
        return user
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def auth_required(f):
    """Decorator that requires a valid auth token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        request.user = user
        return f(*args, **kwargs)
    return decorated


# ========================================
# Auth Routes
# ========================================

@app.route('/api/auth/google', methods=['POST'])
def google_auth():
    """Verify Google OAuth token and create/find user."""
    if not GOOGLE_AUTH_AVAILABLE:
        return jsonify({'error': 'Google Auth not configured on server'}), 500
    
    data = request.get_json()
    token = data.get('credential') if data else None
    
    if not token:
        return jsonify({'error': 'No credential provided'}), 400
    
    try:
        # Verify the Google token
        idinfo = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
        )
        
        # Extract user info
        email = idinfo.get('email', '')
        name = idinfo.get('name', '')
        picture = idinfo.get('picture', '')
        
        if not email:
            return jsonify({'error': 'Could not get email from Google'}), 400
        
        # Create or find user in database
        user = db.get_or_create_user(email, name, picture)
        
        # Create session JWT
        session_token = create_jwt_token(user['id'])
        
        app.logger.info(f"User logged in: {email}")
        
        return jsonify({
            'token': session_token,
            'user': {
                'id': user['id'],
                'name': name,
                'email': email,
                'picture': picture
            }
        })
        
    except Exception as e:
        app.logger.exception("Google token verification failed")
        return jsonify({'error': 'Invalid Google token'}), 401


@app.route('/auth/native', methods=['GET'])
def native_auth_page():
    """Renders a standard HTML page for Google Login in the System Browser (Fix for Android)."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Connect with Google</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://accounts.google.com/gsi/client" async defer></script>
        <style>
            body {{ background: #010101; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: -apple-system, sans-serif; }}
            .logo {{ width: 80px; height: 80px; margin-bottom: 20px; filter: drop-shadow(0 0 10px rgba(255,0,0,0.3)); }}
            h2 {{ font-weight: 500; margin-bottom: 5px; }}
            p {{ color: #aaa; margin-bottom: 30px; }}
        </style>
    </head>
    <body>
        <img src="/favicon.png" class="logo" alt="Logo">
        <h2>Sincronizar con Google</h2>
        <p>Continua para sincronizar tu biblioteca en la App</p>
        
        <div id="g_id_onload"
             data-client_id="{GOOGLE_CLIENT_ID}"
             data-context="signin"
             data-ux_mode="redirect"
             data-login_uri="https://music.dannarita.es/auth/native/callback"
             data-auto_prompt="false">
        </div>

        <div class="g_id_signin"
             data-type="standard"
             data-shape="pill"
             data-theme="filled_black"
             data-text="continue_with"
             data-size="large"
             data-logo_alignment="left">
        </div>
    </body>
    </html>
    """


@app.route('/auth/native/callback', methods=['POST'])
def google_auth_native():
    """Verify Google OAuth token and return Deep Link for Android."""
    if not GOOGLE_AUTH_AVAILABLE:
        return 'Auth not available', 500
    
    token = request.form.get('credential')
    # Since this is the specific native callback, we treat it as an Android flow
    platform = 'android' 
    
    if not token:
        app.logger.error("No credential in form-data for native auth")
        return 'No credential provided', 400
        
    try:
        idinfo = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
        )
        
        email = idinfo.get('email', '')
        name = idinfo.get('name', '')
        picture = idinfo.get('picture', '')
        
        if not email:
            return 'No email from Google', 400
        
        user = db.get_or_create_user(email, name, picture)
        session_token = create_jwt_token(user['id'])
        
        user_json = json.dumps({
            'id': user['id'],
            'name': name,
            'email': email,
            'picture': picture
        })
        
        # IF ANDROID DEEP LINK FLOW
        if platform == 'android':
            import urllib.parse
            user_encoded = urllib.parse.quote(user_json)
            deep_link = f"ytdlauth://auth?token={session_token}&user={user_encoded}"
            
            return f"""
            <!DOCTYPE html>
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body {{ background: #010101; color: #fff; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
                        .container {{ text-align: center; padding: 30px; width: 100%; box-sizing: border-box; }}
                        h2 {{ font-size: 2.8rem; color: #ff0000; margin: 0 0 10px 0; font-weight: 800; letter-spacing: -1px; }}
                        p {{ font-size: 1.3rem; margin: 0 0 40px 0; opacity: 0.9; font-weight: 400; }}
                        .btn {{ 
                            color: #4CAF50; text-decoration: none; border: 2px solid #4CAF50; 
                            padding: 16px 32px; border-radius: 34px; font-weight: 600;
                            display: inline-block; transition: all 0.2s; font-size: 1.1rem;
                            box-shadow: 0 4px 15px rgba(76, 175, 80, 0.2);
                        }}
                        .btn:active {{ transform: scale(0.95); opacity: 0.8; }}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2>¡Éxito!</h2>
                        <p>Iniciando sesión en la App...</p>
                        <a href="{deep_link}" class="btn">Volver a la aplicación</a>
                    </div>
                    <script>
                        window.location.href = "{deep_link}";
                        setTimeout(() => {{
                             window.close();
                        }}, 5000);
                    </script>
                </body>
            </html>
            """
        
        # STANDARD HTML BRIDGE (For Browser fallback)
        return f"""
        <!DOCTYPE html>
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body {{ background: #0f0f0f; color: #fff; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
                    .loader {{ border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #ff0000; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin-bottom: 20px; }}
                    @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
                    .container {{ text-align: center; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="loader"></div>
                    <div style="font-size: 1.1rem; font-weight: 500;">Sincronizando...</div>
                </div>
                <script>
                    localStorage.setItem('auth_token', '{session_token}');
                    localStorage.setItem('auth_user', JSON.stringify({user_json}));
                    window.location.href = '/';
                </script>
            </body>
        </html>
        """
        
    except Exception as e:
        app.logger.exception("Google token verification failed (Native)")
        return 'Token invalido', 401


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    """Get current user info from session token."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    
    return jsonify({
        'user': {
            'id': user['id'],
            'name': user['name'],
            'email': user['email'],
            'picture': user['picture']
        }
    })


# ========================================
# User Data Routes (Authenticated)
# ========================================

@app.route('/api/user/history', methods=['GET'])
@auth_required
def get_user_history():
    """Get authenticated user's download history."""
    history = db.get_history(request.user['id'])
    return jsonify({'history': history})


@app.route('/api/user/history', methods=['POST'])
@auth_required
def add_user_history():
    """Add item to authenticated user's download history."""
    data = request.get_json()
    if not data:
        return jsonify({'error': NO_DATA_ERROR}), 400
    
    db.add_history(request.user['id'], data)
    return jsonify({'status': 'ok'})


@app.route('/api/user/history', methods=['DELETE'])
@auth_required
def clear_user_history():
    """Clear authenticated user's download history."""
    db.clear_history(request.user['id'])
    return jsonify({'status': 'ok'})


@app.route('/api/user/favorites', methods=['GET'])
@auth_required
def get_user_favorites():
    """Get authenticated user's favorites."""
    favorites = db.get_favorites(request.user['id'])
    return jsonify({'favorites': favorites})


@app.route('/api/user/favorites', methods=['POST'])
@auth_required
def add_user_favorite():
    """Add a video to authenticated user's favorites."""
    data = request.get_json()
    if not data:
        return jsonify({'error': NO_DATA_ERROR}), 400
    
    db.add_favorite(request.user['id'], data)
    return jsonify({'status': 'ok'})


@app.route('/api/user/favorites/<video_id>', methods=['DELETE'])
@auth_required
def remove_user_favorite(video_id):
    """Remove a video from authenticated user's favorites."""
    db.remove_favorite(request.user['id'], video_id)
    return jsonify({'status': 'ok'})


@app.route('/api/user/sync', methods=['POST'])
@auth_required
def sync_user_data():
    """Sync localStorage data to server on first login."""
    data = request.get_json()
    if not data:
        return jsonify({'error': NO_DATA_ERROR}), 400
    
    history = data.get('history', [])
    favorites = data.get('favorites', [])
    
    db.sync_user_data(request.user['id'], history, favorites)
    
    # Return the merged data
    merged_history = db.get_history(request.user['id'])
    merged_favorites = db.get_favorites(request.user['id'])
    
    app.logger.info(f"Synced data for user {request.user['id']}: {len(history)} history, {len(favorites)} favorites")
    
    return jsonify({
        'status': 'ok',
        'history': merged_history,
        'favorites': merged_favorites
    })


# ========================================
# Error Handlers
# ========================================

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint no encontrado'}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Error interno del servidor'}), 500


# ========================================
# Main Entry Point
# ========================================

if __name__ == '__main__':
    # Initialize database
    db.init_db()
    
    # Ensure temp directory exists
    os.makedirs(TEMP_DIR, exist_ok=True)
    
    print("""
    +-----------------------------------------------------------+
    |         YouTube Music Downloader - Backend Server         |
    +-----------------------------------------------------------+
    |  Server running at: http://localhost:5000                 |
    |  Open index.html in your browser or visit the URL above   |
    +-----------------------------------------------------------+
    """)
    
    # Run the Flask development server
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,  # IMPORTANT: False for production/ngrok use
        threaded=True
    )
