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
from datetime import datetime
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS

# ========================================
# Flask App Configuration
# ========================================
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # Enable CORS for frontend communication

# Configuration
DOWNLOAD_TIMEOUT = 1800  # 30 minutes timeout for large playlists
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'youtube_downloader')

# FFmpeg Configuration - Add local FFmpeg to PATH
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_DIR = os.path.join(SCRIPT_DIR, 'ffmpeg-master-latest-win64-gpl', 'bin')
if os.path.exists(FFMPEG_DIR):
    os.environ['PATH'] = FFMPEG_DIR + os.pathsep + os.environ.get('PATH', '')

# Store for download progress
download_progress = {}

# ========================================
# Utility Functions
# ========================================

def validate_youtube_url(url):
    """
    Validates if the given URL is a valid YouTube URL
    Returns the type of content (video, playlist, shorts) or None if invalid
    """
    # Check for playlist in watch URL first (video with playlist context)
    if 'youtube.com/watch' in url and 'list=' in url:
        match = re.search(r'list=([a-zA-Z0-9_-]+)', url)
        if match:
            return 'playlist', match.group(1)
    
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
    audio_extensions = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
    audio_files = [f for f in os.listdir(folder_path) 
                   if f.lower().endswith(audio_extensions)]
    
    if not audio_files:
        return None
    
    zip_path = os.path.join(folder_path, f"{zip_name}.zip")
    shutil.make_archive(
        os.path.join(folder_path, zip_name),
        'zip',
        folder_path,
        '.'
    )
    
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


@app.route('/api/progress/<download_id>')
def get_progress(download_id):
    """Get current download progress"""
    if download_id in download_progress:
        return jsonify(download_progress[download_id])
    return jsonify({'status': 'unknown', 'message': 'Download not found'}), 404


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
        content_type, content_id = validate_youtube_url(input_text)
        if not content_type:
            return jsonify({'error': 'URL de YouTube no válida'}), 400
        search_query = input_text
        
        # Get playlist count if it's a playlist
        if content_type == 'playlist':
            total_count = get_playlist_count(input_text) or 0
        else:
            total_count = 1
    
    # Create unique download ID
    download_id = str(uuid.uuid4())[:8]
    download_folder = os.path.join(TEMP_DIR, download_id)
    os.makedirs(download_folder, exist_ok=True)
    
    # Initialize progress
    download_progress[download_id] = {
        'status': 'starting',
        'current': 0,
        'total': total_count,
        'message': 'Iniciando descarga...'
    }
    
    # Start download in background thread
    def run_download():
        nonlocal total_count
        try:
            ffmpeg_path = os.path.join(FFMPEG_DIR, 'ffmpeg.exe') if os.path.exists(FFMPEG_DIR) else 'ffmpeg'
            
            # Build command
            cmd = [
                sys.executable, '-m', 'yt_dlp',
                '--no-check-certificates',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '-o', '%(title)s.%(ext)s',  # Relative path since cwd is download_folder
                '--ffmpeg-location', ffmpeg_path,
                '--no-warnings',
                '--ignore-errors',
                '--encoding', 'utf-8',
            ]
            
            # Add playlist handling
            if content_type not in ['playlist']:
                cmd.append('--no-playlist')
            
            cmd.append(search_query)
            
            app.logger.info(f"Running command: {' '.join(cmd[:5])}...")
            
            # Start a thread to monitor file count while download runs
            stop_monitor = threading.Event()
            
            def monitor_files():
                while not stop_monitor.is_set():
                    current_count = count_downloaded_files(download_folder)
                    download_progress[download_id] = {
                        'status': 'downloading',
                        'current': current_count,
                        'total': total_count,
                        'message': f'Descargando... {current_count} de {total_count} canciones'
                    }
                    time.sleep(1)
            
            monitor_thread = threading.Thread(target=monitor_files, daemon=True)
            monitor_thread.start()
            
            # Create a batch file with the command to avoid shell escaping issues
            batch_file = os.path.join(download_folder, 'download.bat')
            log_file = os.path.join(download_folder, 'ytdlp_log.txt')
            
            # Build the command line for the batch file
            cmd_line = ' '.join(f'"{c}"' if ' ' in c or '&' in c or '?' in c or '=' in c or '%' in c else c for c in cmd)
            
            # Write batch file
            with open(batch_file, 'w', encoding='utf-8') as f:
                f.write('@echo off\n')
                f.write(f'{cmd_line} > "{log_file}" 2>&1\n')
            
            app.logger.info(f"Running batch file: {batch_file}")
            
            # Run the batch file
            result = subprocess.run(
                [batch_file],
                shell=True,
                cwd=download_folder,
            )
            
            # Log the output for debugging
            if os.path.exists(log_file):
                with open(log_file, 'r', encoding='utf-8', errors='replace') as f:
                    log_content = f.read()
                    app.logger.info(f"yt-dlp output: {log_content[:1000]}")
            
            # Stop the monitor thread
            stop_monitor.set()
            monitor_thread.join(timeout=2)
            
            app.logger.info(f"yt-dlp finished with code {result.returncode}")
            
            # Wait for file system to sync
            time.sleep(2)
            
            # Final count
            final_count = count_downloaded_files(download_folder)
            app.logger.info(f"Final file count: {final_count}")
            
            if final_count > 0:
                download_progress[download_id] = {
                    'status': 'complete',
                    'current': final_count,
                    'total': total_count if total_count > 0 else final_count,
                    'message': f'¡{final_count} canciones descargadas!'
                }
            else:
                # Log what files exist
                all_files = os.listdir(download_folder) if os.path.exists(download_folder) else []
                app.logger.error(f"No audio files. Files in folder: {all_files}")
                app.logger.error(f"yt-dlp return code: {result.returncode}")
                download_progress[download_id] = {
                    'status': 'error',
                    'current': 0,
                    'total': total_count,
                    'message': 'No se pudo descargar ninguna canción'
                }
                
        except Exception as e:
            app.logger.error(f"Download error: {str(e)}")
            import traceback
            app.logger.error(traceback.format_exc())
            download_progress[download_id] = {
                'status': 'error',
                'current': count_downloaded_files(download_folder),
                'total': total_count,
                'message': f'Error: {str(e)}'
            }
    
    thread = threading.Thread(target=run_download, daemon=True)
    thread.start()
    
    return jsonify({
        'download_id': download_id,
        'total': total_count
    })


@app.route('/api/download/<download_id>', methods=['GET'])
def get_download(download_id):
    """Get the downloaded files for a completed download"""
    download_folder = os.path.join(TEMP_DIR, download_id)
    
    if not os.path.exists(download_folder):
        return jsonify({'error': 'Descarga no encontrada'}), 404
    
    audio_extensions = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
    downloaded_files = [f for f in os.listdir(download_folder) 
                       if f.lower().endswith(audio_extensions)]
    
    if not downloaded_files:
        cleanup_temp_folder(download_folder)
        return jsonify({'error': 'No hay archivos para descargar'}), 404
    
    # If only one file, send it directly
    if len(downloaded_files) == 1:
        file_path = os.path.join(download_folder, downloaded_files[0])
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
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_name = f"youtube_playlist_{timestamp}"
    zip_path = create_zip_from_folder(download_folder, zip_name)
    
    if not zip_path or not os.path.exists(zip_path):
        cleanup_temp_folder(download_folder)
        return jsonify({'error': 'Error al crear el archivo ZIP'}), 500
    
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
    
    return response


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
        debug=True,
        threaded=True
    )
