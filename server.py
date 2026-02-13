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
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
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
MAX_WORKERS = 5
executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS)

# Configuration
DOWNLOAD_TIMEOUT = 1800  # 30 minutes timeout for large playlists
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'youtube_downloader')

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
    if os.path.exists(FFMPEG_DIR):
        os.environ['PATH'] = FFMPEG_DIR + os.pathsep + os.environ.get('PATH', '')
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
            # Radio/Mix playlists start with 'RD' - treat as regular video instead
            if not playlist_id.startswith('RD'):
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
        app.logger.error(f"Error cleaning up folder {folder_path}: {e}")


def create_zip_from_folder(folder_path, zip_name):
    """
    Creates a ZIP file from all audio files in the folder
    Returns the path to the ZIP file
    """
    import zipfile
    
    audio_extensions = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
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
    audio_extensions = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
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
        app.logger.error(f"Error getting playlist count: {e}")
    return None


# ========================================
# API Routes
# ========================================

@app.route('/')
def index():
    """Serve the frontend"""
    return send_file('index.html')


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
        
        # Parse JSON output (one JSON object per line)
        results = []
        for line in result.stdout.strip().split('\n'):
            if line:
                try:
                    video = json.loads(line)
                    # Extract relevant info
                    video_id = video.get('id', '')
                    if video_id:
                        results.append({
                            'id': video_id,
                            'title': video.get('title', 'Sin título'),
                            'thumbnail': f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
                            'duration': video.get('duration', 0),
                            'channel': video.get('channel', video.get('uploader', 'Canal desconocido')),
                            'url': f"https://www.youtube.com/watch?v={video_id}"
                        })
                except json.JSONDecodeError:
                    continue
        
        if not results:
            return jsonify({'error': 'No se encontraron resultados'}), 404
        
        return jsonify({'results': results})
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'La búsqueda tardó demasiado'}), 504
    except Exception as e:
        app.logger.error(f"Search error: {str(e)}")
        return jsonify({'error': f'Error: {str(e)}'}), 500


@app.route('/api/playlist-info', methods=['POST'])
def get_playlist_info():
    """Get information about all videos in a playlist"""
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': 'No se proporcionó URL de playlist'}), 400
    
    url = data['url'].strip()
    
    # Extract playlist ID
    match = re.search(r'list=([a-zA-Z0-9_-]+)', url)
    if not match:
        return jsonify({'error': 'URL de playlist no válida'}), 400
    
    playlist_id = match.group(1)
    
    # Check for Radio/Mix playlists
    if playlist_id.startswith('RD'):
        return jsonify({
            'error': 'MIX_PLAYLIST_ERROR'
        }), 400
    
    playlist_url = f"https://www.youtube.com/playlist?list={playlist_id}"
    
    try:
        # Use yt-dlp to get playlist info
        result = subprocess.run(
            [
                sys.executable, '-m', 'yt_dlp',
                playlist_url,
                '--dump-json',
                '--flat-playlist',
                '--no-warnings',
                '--no-download',
            ],
            capture_output=True,
            text=True,
            timeout=60,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            app.logger.error(f"yt-dlp playlist error: {result.stderr}")
            return jsonify({'error': 'Error al obtener información de la playlist'}), 500
        
        # Parse JSON output (one JSON object per line)
        videos = []
        for line in result.stdout.strip().split('\n'):
            if line:
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
        
        if not videos:
            return jsonify({'error': 'No se encontraron videos en la playlist'}), 404
        
        return jsonify({
            'videos': videos,
            'total': len(videos)
        })
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'La consulta tardó demasiado'}), 504
    except Exception as e:
        app.logger.error(f"Playlist info error: {str(e)}")
        return jsonify({'error': f'Error: {str(e)}'}), 500


@app.route('/api/progress/<download_id>')
def get_progress(download_id):
    """Get current download progress"""
    if download_id in download_progress:
        progress = download_progress[download_id]
        if progress.get('status') == 'complete':
            app.logger.info(f"Returning complete status for {download_id}")
        return jsonify(progress)
    return jsonify({'status': 'unknown', 'message': 'Download not found'}), 404


@app.route('/api/cancel/<download_id>', methods=['POST'])
def cancel_download(download_id):
    """Cancel an active download"""
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
            app.logger.error(f"Error terminating process: {e}")
    
    # Update progress status
    download_progress[download_id] = {
        'status': 'cancelled',
        'current': 0,
        'total': download_progress[download_id].get('total', 0),
        'message': 'Descarga cancelada'
    }
    
    # Clean up temp folder
    download_folder = os.path.join(TEMP_DIR, download_id)
    cleanup_temp_folder(download_folder)
    
    # Clean up tracking dicts
    if download_id in download_cancellation:
        del download_cancellation[download_id]
    if download_id in download_processes:
        del download_processes[download_id]
    
    app.logger.info(f"Download {download_id} cancelled successfully")
    return jsonify({'status': 'cancelled', 'message': 'Download cancelled'})


@app.route('/api/start-batch-download', methods=['POST'])
def start_batch_download():
    """Start batch download for multiple videos from a playlist in parallel"""
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
    
    # Initialize progress
    download_progress[download_id] = {
        'status': 'starting',
        'current': 0,
        'total': total_count,
        'message': f'Iniciando descarga paralela de {total_count} canciones...'
    }
    
    # Initialize cancellation event for this batch download
    download_cancellation[download_id] = threading.Event()
    
    def download_single_item(video_info, output_folder, audio_quality):
        """Helper to download one item safely"""
        try:
            url = video_info.get('url', '')
            title = video_info.get('title', 'video')
            
            ffmpeg_path = FFMPEG_PATH
            
            cmd = [
                sys.executable, '-m', 'yt_dlp',
                '--no-check-certificates',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', f'{audio_quality}K',
                '--embed-thumbnail',  # Embed thumbnail
                '--add-metadata',     # Add metadata
                '-o', '%(title)s.%(ext)s',
                '--ffmpeg-location', ffmpeg_path,
                '--no-warnings',
                '--ignore-errors',
                '--no-playlist', 
                url
            ]

            
            # Use subprocess to run yt-dlp
            # We don't use a lock here because we want parallelism
            proc = subprocess.run(
                cmd,
                cwd=output_folder,
                capture_output=True,
                timeout=600, # 10 mins per song max
                encoding='utf-8',
                errors='replace'
            )
            
            if proc.returncode == 0:
                print(f"[OK] Downloaded: {title}")
                # Return success and title - logging will be done at the end
                return (True, title)
            else:
                print(f"[ERROR] Failed {title}: {proc.stderr}")
                return (False, None)
                
        except Exception as e:
            print(f"[ERROR] Exception {url}: {e}")
            return (False, None)

    def run_parallel_batch():
        try:
            completed_count = 0
            
            # Submit all tasks to the executor
            futures = []
            for video in videos:
                futures.append(executor.submit(download_single_item, video, download_folder, quality))
                
            # Wait for completion and update progress
            for i, future in enumerate(concurrent.futures.as_completed(futures)):
                try:
                    success, title = future.result()
                    if success:
                        completed_count += 1
                except Exception as e:
                    print(f"Task exception: {e}")
                
                # Update progress
                current_done = i + 1
                percent = int((current_done / total_count) * 100)
                
                download_progress[download_id] = {
                    'status': 'downloading',
                    'current': current_done,
                    'total': total_count,
                    'message': f'Procesando: {current_done}/{total_count} completados ({percent}%)'
                }
            
            # Check if download was cancelled
            was_cancelled = download_id in download_cancellation and download_cancellation[download_id].is_set()
                
            # Final check
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
            app.logger.error(f"Batch parallel error: {str(e)}")
            download_progress[download_id] = {
                'status': 'error',
                'current': 0,
                'total': total_count,
                'message': f'Error fatal: {str(e)}'
            }
    
    # Run the coordination flow in a separate thread
    # This thread just manages futures, doesn't do heavy lifting
    coordinator_thread = threading.Thread(target=run_parallel_batch, daemon=True)
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
            except:
                return 0
                
        app.logger.warning(f"Playlist count failed (code {result.returncode}): {result.stderr}")
        return 0
    except Exception as e:
        app.logger.error(f"Error getting playlist count: {str(e)}")
        return 0


@app.route('/api/start-download', methods=['POST'])
def start_download():
    """Start download and return download_id for progress tracking"""
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': 'No se proporcionó URL o búsqueda'}), 400
    
    input_text = data['url'].strip()
    
    if not input_text:
        return jsonify({'error': 'El campo está vacío'}), 400
    
    # Determine if it's a URL or search query
    if is_search_query(input_text):
        search_query = f"ytsearch:{input_text}"
        content_type = 'search'
        total_count = 1
    else:
        # Check for Radio/Mix playlists (RD...) which cannot be downloaded
        mix_match = re.search(r'list=(RD[a-zA-Z0-9_-]+)', input_text)
        if mix_match:
            return jsonify({
                'error': 'MIX_PLAYLIST_ERROR'
            }), 400
        
        content_type, content_id = validate_youtube_url(input_text)
        if not content_type:
            return jsonify({'error': 'URL de YouTube no válida'}), 400
        
        # If it's a playlist, convert the URL to a proper playlist URL
        # This handles cases where the URL is a video with a playlist context
        if content_type == 'playlist':
            # Build proper playlist URL to ensure all videos are downloaded
            search_query = f"https://www.youtube.com/playlist?list={content_id}"
            total_count = get_playlist_count(search_query) or 0
        else:
            search_query = input_text
            total_count = 1
    
    # Get selected quality (default 192 if not provided)
    quality = str(data.get('quality', '192'))
    
    # Create unique download ID
    download_id = str(uuid.uuid4())[:8]
    download_folder = os.path.join(TEMP_DIR, download_id)
    os.makedirs(download_folder, exist_ok=True)
    
    # Initialize progress
    download_progress[download_id] = {
        'status': 'starting',
        'current': 0,
        'total': total_count,
        'message': 'Iniciando descarga...',
        'video_id': content_id if content_type == 'video' else None
    }
    
    # Initialize cancellation event
    download_cancellation[download_id] = threading.Event()

    # Pre-fetch metadata for single video to show in UI immediately
    if content_type == 'video':
        try:
            meta_result = subprocess.run(
                [
                    sys.executable, '-m', 'yt_dlp',
                    '--dump-json',
                    '--no-playlist',
                    '--no-warnings',
                    search_query
                ],
                capture_output=True,
                text=True,
                timeout=10,
                encoding='utf-8',
                errors='replace'
            )
            if meta_result.returncode == 0:
                video_meta = json.loads(meta_result.stdout)
                title = video_meta.get('title', 'Video')
                thumbnail = f"https://i.ytimg.com/vi/{video_meta.get('id')}/mqdefault.jpg"
                
                # Update progress with metadata immediately
                download_progress[download_id].update({
                    'title': title,
                    'thumbnail': thumbnail
                })
        except Exception as e:
            app.logger.warning(f"Could not fetch metadata: {e}")
    
    # Start download in background thread
    def run_download():
        nonlocal total_count
        download_folder = os.path.join(TEMP_DIR, download_id)
        
        try:
            ffmpeg_path = FFMPEG_PATH
            
            # Build command
            cmd = [
                sys.executable, '-m', 'yt_dlp',
                '--no-check-certificates',
                # '--user-agent', ... # Removed to avoid 400 Bad Request
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', f'{quality}K',
                '--embed-thumbnail',
                '--add-metadata',
                '-o', '%(title)s.%(ext)s',
                '--ffmpeg-location', ffmpeg_path,
                '--ignore-errors',
                '--encoding', 'utf-8',
                # Log downloaded titles to stdout -> captured by server
                '--print', 'after_video:DOWNLOAD_LOG_TITLE:%(title)s',
            ]
            
            # Add playlist handling
            if content_type not in ['playlist']:
                cmd.append('--no-playlist')
            
            cmd.append(search_query)
            
            app.logger.info(f"Running command: {' '.join(cmd[:5])}...")
            
            # Start a thread to monitor file count while download runs
            stop_monitor = threading.Event()
            
            def monitor_files():
                while not stop_monitor.wait(timeout=1):
                    current_count = count_downloaded_files(download_folder)
                    
                    # Try to infer title from filenames if we don't have it
                    current_title = None
                    try:
                        files = os.listdir(download_folder)
                        for f in files:
                            if f.endswith(('.mp3', '.m4a', '.webm', '.part', '.ytdl')):
                                name = os.path.splitext(f)[0]
                                while '.' in name:
                                    name = os.path.splitext(name)[0]
                                if len(name) > 0 and name != 'download' and 'ytdlp' not in name:
                                    current_title = name
                                    break
                    except:
                        pass

                    if download_id in download_progress:
                        update_data = {
                            'status': 'downloading',
                            'current': current_count,
                            'total': total_count,
                            'message': f'Descargando... {current_count} de {total_count} canciones'
                        }
                        if current_title:
                            current_info = download_progress[download_id]
                            if not current_info.get('title') or current_info.get('title') == 'YouTube Video':
                                update_data['title'] = current_title
                        
                        download_progress[download_id].update(update_data)
            
            monitor_thread = threading.Thread(target=monitor_files, daemon=True)
            monitor_thread.start()

            # Execute yt-dlp
            proc = subprocess.Popen(
                cmd,
                cwd=download_folder,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                encoding='utf-8',
                errors='replace',
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            
            download_processes[download_id] = proc
            
            # Read stdout loop
            while True:
                if download_id in download_cancellation and download_cancellation[download_id].is_set():
                    proc.terminate()
                    break
                    
                line = proc.stdout.readline()
                if not line and proc.poll() is not None:
                    break
                    
                if line:
                    line = line.strip()
                    # Check for logged title
                    if line.startswith('DOWNLOAD_LOG_TITLE:'):
                        continue

                    # Parse progress
                    if '[download]' in line and '%' in line:
                        try:
                            parts = line.split()
                            percent_str = next((p for p in parts if '%' in p), '0%')
                            if download_id in download_progress:
                                download_progress[download_id]['message'] = f"Descargando: {percent_str}"
                        except:
                            pass
            
            proc.wait()
            
            # Stop monitor
            stop_monitor.set()
            monitor_thread.join(timeout=5)
            
            app.logger.info(f"yt-dlp finished with code {proc.returncode}")

            # Check cancellation again
            if download_id in download_cancellation and download_cancellation[download_id].is_set():
                app.logger.info(f"Download {download_id} cancelled")
                return

            # Final status update
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

        except Exception as e:
            app.logger.error(f"Download error: {str(e)}")
            import traceback
            app.logger.error(traceback.format_exc())
            if download_id in download_progress:
                download_progress[download_id].update({
                    'status': 'error',
                    'message': f"Error interno: {str(e)}"
                })
        finally:
            if download_id in download_processes:
                del download_processes[download_id]

    # Submit to thread pool
    executor.submit(run_download)
    
    return jsonify({
        'download_id': download_id,
        'total': total_count,
        'title': download_progress[download_id].get('title'),
        'thumbnail': download_progress[download_id].get('thumbnail')
    })


@app.route('/api/download/<download_id>', methods=['GET'])
def get_download(download_id):
    """Get the downloaded files for a completed download"""
    app.logger.info(f"Download request received for {download_id}")
    download_folder = os.path.join(TEMP_DIR, download_id)
    
    if not os.path.exists(download_folder):
        app.logger.error(f"Download folder not found: {download_folder}")
        return jsonify({'error': 'Descarga no encontrada'}), 404
    
    audio_extensions = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
    downloaded_files = [f for f in os.listdir(download_folder) 
                       if f.lower().endswith(audio_extensions)]
    app.logger.info(f"Found {len(downloaded_files)} audio files")
    
    if not downloaded_files:
        cleanup_temp_folder(download_folder)
        return jsonify({'error': 'No hay archivos para descargar'}), 404
    
    # If only one file, send it directly
    if len(downloaded_files) == 1:
        file_path = os.path.join(download_folder, downloaded_files[0])
        app.logger.info(f"Sending single file: {file_path}")
        response = send_file(
            file_path,
            mimetype='audio/mpeg',
            as_attachment=True,
            download_name=downloaded_files[0]
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
        app.logger.error(f"Error creating ZIP: {e}")
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
    
    app.logger.info(f"Response prepared, returning to client")
    return response


# ========================================
# Auth Helpers
# ========================================

def create_jwt_token(user_id):
    """Create a JWT token for a user session."""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        'iat': datetime.utcnow()
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
        
    except ValueError as e:
        app.logger.error(f"Google token verification failed: {e}")
        return jsonify({'error': 'Invalid Google token'}), 401


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
        return jsonify({'error': 'No data provided'}), 400
    
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
        return jsonify({'error': 'No data provided'}), 400
    
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
        return jsonify({'error': 'No data provided'}), 400
    
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
    ╔═══════════════════════════════════════════════════════════╗
    ║         YouTube Music Downloader - Backend Server         ║
    ╠═══════════════════════════════════════════════════════════╣
    ║  Server running at: http://localhost:5000                 ║
    ║  Open index.html in your browser or visit the URL above   ║
    ╚═══════════════════════════════════════════════════════════╝
    """)
    
    # Run the Flask development server
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,  # IMPORTANT: False for production/ngrok use
        threaded=True
    )
