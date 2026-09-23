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
import zipfile
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import safe_join
import concurrent.futures
import contextlib
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
# static_folder=None a propósito (plan 02, T0): con static_folder='.' Flask
# publicaba el directorio del proyecto entero, incluidos server.py y
# data/youtube_downloader.db. Todo lo que se sirve tiene ahora ruta explícita.
app = Flask(__name__, static_folder=None)

# Un proxy de confianza por delante (nginx). x_for=1 es el número real de
# proxies: un valor mayor permitiría al cliente falsear su IP con
# X-Forwarded-For, y el rate limiting dejaría de servir para nada.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Orígenes permitidos por CORS.
# https://localhost NO es opcional: la APK carga desde assets locales con
# androidScheme 'https', así que sus peticiones salen con ese Origin. Quitarlo
# deja la aplicación Android sin acceso a la API.
ALLOWED_ORIGINS = [
    'https://music.dannarita.es',
    'https://localhost',        # WebView de Capacitor en Android
    'capacitor://localhost',    # WebView de Capacitor en iOS
    'http://localhost:5173',    # Vite en desarrollo
    'http://127.0.0.1:5173',
]
CORS(app, origins=ALLOWED_ORIGINS, expose_headers=["Content-Disposition"])

# Rate limiting por IP. /api/progress queda exento porque el cliente lo sondea
# cada segundo durante toda la descarga (se revisará cuando el plan 07 lo
# sustituya por SSE).
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per hour"],
    storage_uri="memory://",
    strategy="fixed-window",
)

# Thread Pool for Parallel Downloads
MAX_WORKERS = 5  # Parallel downloads (safe for M4A - no CPU-heavy conversion)
executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS)

# Pool separado para los coordinadores de descarga en lote. Si fuesen al
# executor principal, varios lotes simultáneos ocuparían todos los workers
# esperando a que se ejecuten sus propias descargas en ese mismo pool:
# el interbloqueo clásico de los pools compartidos.
MAX_BATCH_COORDINATORS = 2
batch_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=MAX_BATCH_COORDINATORS, thread_name_prefix='batch-coord'
)
MAX_BATCH_VIDEOS = 100

# ========================================
# Excepciones del proyecto (plan 06, T1)
# ========================================
#
# Sin tipos propios, "entrada inválida del usuario" (-> 400) y "fallo interno"
# (-> 500) son la misma excepción y el manejador tiene que adivinar cuál es.

class DownloadError(Exception):
    """Fallo al descargar contenido. El mensaje es apto para enseñar al usuario."""


class InvalidInputError(DownloadError):
    """La entrada del usuario no es una URL ni una búsqueda válida."""


class YtDlpError(DownloadError):
    """yt-dlp terminó con error, agotó su tiempo o devolvió algo no parseable."""


# Formatos de audio que el cliente puede pedir (plan 05, T1).
# Lista blanca, nunca el valor del usuario tal cual: acaba en --audio-format de
# yt-dlp. No hay riesgo de inyección (el comando es una lista, no una cadena),
# pero un valor arbitrario provocaría un fallo opaco a mitad de descarga.
AUDIO_FORMATS = frozenset({'m4a', 'mp3'})
DEFAULT_AUDIO_FORMAT = 'm4a'

# mp3 re-codifica con ffmpeg, que es intensivo en CPU; m4a solo remuxea.
# El pool de descargas sigue en 5, pero solo 2 pueden estar transcodificando a
# la vez: una playlist en m4a baja 5 en paralelo como siempre, y una en mp3
# convierte de dos en dos en vez de asfixiar los 2 núcleos del servidor.
MAX_TRANSCODES = 2
transcode_slots = threading.Semaphore(MAX_TRANSCODES)

# Configuration
DOWNLOAD_TIMEOUT = 1800  # 30 minutes timeout for large playlists
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'youtube_downloader')
AUDIO_EXTENSIONS = ('.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav')
INVALID_DOWNLOAD_ID_ERROR = 'Invalid download ID'
NO_DATA_ERROR = 'No data provided'
MIMETYPE_AUDIO_MPEG = 'audio/mpeg'

# Google OAuth Configuration
GOOGLE_CLIENT_ID = '938078752300-e59ed4ln5bjeqeb8rfomfjtdtebqcckt.apps.googleusercontent.com'

# Sin valor por defecto a propósito (plan 02, T1): antes había uno literal en el
# código, y como el código era descargable (T0) cualquiera podía firmar tokens
# válidos de cualquier usuario. Abortar es preferible a arrancar con un secreto
# conocido, porque ese fallo es silencioso y permanente.
JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET no está definida. Genera una con:\n"
        "  python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"\n"
        "y expórtala en el entorno del servicio antes de arrancar."
    )
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
    FFMPEG_PATH = None  # se resuelve justo debajo


def find_ffmpeg(which=shutil.which):
    """
    ffmpeg del PATH, o /usr/bin/ffmpeg si no está.

    En Linux es el mismo sitio, pero en macOS Homebrew lo deja en
    /opt/homebrew/bin o /usr/local/bin. Con la ruta de Linux fijada, en Mac
    yt-dlp no encontraba ffmpeg y toda descarga real fallaba.
    """
    return which('ffmpeg') or '/usr/bin/ffmpeg'


if FFMPEG_PATH is None:
    FFMPEG_PATH = find_ffmpeg()

# Streaming: techo de bytes por respuesta parcial (plan 03, T3)
MAX_RANGE_CHUNK = 4 * 1024 * 1024        # 4 MB

# Ciclo de vida de las descargas (plan 03, T5)
DOWNLOAD_TTL_SECONDS = 3600              # 1 hora sin cambios -> se descarta
SWEEP_INTERVAL_SECONDS = 600             # barrido cada 10 minutos
ACTIVE_STATUSES = ('starting', 'downloading')

# Store for download progress
download_progress = {}

# Store for cancellation tracking
download_cancellation = {}  # download_id -> threading.Event (set = cancelled)
download_processes = {}     # download_id -> subprocess.Popen object

# Los tres diccionarios de arriba los escriben varios hilos a la vez (el monitor
# de ficheros, el lector de stdout de yt-dlp y las peticiones HTTP). Antes no
# había ninguna sincronización.
download_lock = threading.Lock()


# ========================================
# Registro central de descargas (plan 03, T4)
# ========================================

def register_download(download_id, total_count, **extra):
    """Único punto de alta. Toda entrada nace con created_at y updated_at."""
    now = time.time()
    with download_lock:
        download_progress[download_id] = {
            'status': 'starting',
            'current': 0,
            'total': total_count,
            'message': 'Iniciando descarga...',
            'code': 'starting',
            'params': {},
            'created_at': now,
            'updated_at': now,
            **extra,
        }
        download_cancellation[download_id] = threading.Event()


def update_progress(download_id, **fields):
    """
    Único punto de escritura del progreso. Refresca `updated_at`, que es lo que
    permite al barrido distinguir una descarga viva de una colgada.
    """
    with download_lock:
        entry = download_progress.get(download_id)
        if entry is None:
            return False
        entry.update(fields)
        entry['updated_at'] = time.time()
        return True


def terminate_download_process(download_id):
    """Mata el proceso de yt-dlp asociado, si sigue vivo."""
    proc = download_processes.get(download_id)
    if proc is None or proc.poll() is not None:
        return
    try:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        app.logger.info(f"Proceso terminado para {download_id}")
    except (OSError, subprocess.SubprocessError):
        app.logger.exception(f"Error terminando el proceso de {download_id}")


def forget_download(download_id, remove_folder=True):
    """
    Único punto de baja: limpia las tres estructuras y la carpeta.
    Antes esa limpieza estaba repartida y era incompleta, que es de donde salía
    la fuga de memoria y de disco.
    """
    terminate_download_process(download_id)

    with download_lock:
        download_progress.pop(download_id, None)
        download_cancellation.pop(download_id, None)
        download_processes.pop(download_id, None)

    if remove_folder:
        folder = safe_download_path(download_id)
        if folder:
            cleanup_temp_folder(folder)


# ========================================
# Barrido periódico (plan 03, T5)
# ========================================

def sweep_stale_downloads():
    """Descarta descargas inactivas y sus carpetas. Devuelve cuántas quitó."""
    now = time.time()
    with download_lock:
        caducadas = [
            did for did, p in download_progress.items()
            if now - p.get('updated_at', p.get('created_at', 0)) > DOWNLOAD_TTL_SECONDS
            and p.get('status') not in ACTIVE_STATUSES
        ]

    for did in caducadas:
        app.logger.info(f"Barrido: descartando descarga inactiva {did}")
        forget_download(did)
    return len(caducadas)


def sweep_orphan_folders():
    """Borra carpetas de TEMP_DIR sin entrada viva y con antigüedad suficiente."""
    if not os.path.isdir(TEMP_DIR):
        return 0

    now = time.time()
    borradas = 0
    for entry in Path(TEMP_DIR).iterdir():
        if not entry.is_dir() or entry.name in download_progress:
            continue
        try:
            if now - entry.stat().st_mtime > DOWNLOAD_TTL_SECONDS:
                cleanup_temp_folder(str(entry))
                borradas += 1
        except OSError:
            continue
    return borradas


def start_sweeper():
    """Lanza el hilo de barrido. Idempotente."""
    if getattr(start_sweeper, '_started', False):
        return
    start_sweeper._started = True

    def loop():
        while True:
            time.sleep(SWEEP_INTERVAL_SECONDS)
            try:
                n = sweep_stale_downloads() + sweep_orphan_folders()
                if n:
                    app.logger.info(f"Barrido: {n} elementos liberados")
            except Exception:
                # `except Exception` deliberado: si este hilo muere, la fuga de
                # memoria y de disco vuelve en silencio. Es la excepción a la
                # regla que el plan 06 aplicará al resto del fichero.
                app.logger.exception("Error en el barrido periódico")

    threading.Thread(target=loop, daemon=True, name='sweeper').start()


def purge_temp_dir_on_boot():
    """
    Al arrancar no hay ninguna descarga en curso, así que nada de lo que quede
    en TEMP_DIR es recuperable: son restos de la ejecución anterior.
    """
    if not os.path.isdir(TEMP_DIR):
        return
    for entry in os.listdir(TEMP_DIR):
        cleanup_temp_folder(os.path.join(TEMP_DIR, entry))
    app.logger.info("TEMP_DIR limpiado al arrancar")


def bootstrap():
    """
    Inicialización que debe correr tanto con `python server.py` como bajo WSGI.

    Antes vivía dentro de `if __name__ == '__main__'` y funcionaba de casualidad:
    con gunicorn ese bloque no se ejecuta, la base de datos no se inicializaría y
    la primera descarga fallaría con FileNotFoundError sobre TEMP_DIR.
    """
    if os.environ.get('YTDL_SKIP_BOOTSTRAP'):
        return
    db.init_db()
    os.makedirs(TEMP_DIR, exist_ok=True)
    purge_temp_dir_on_boot()
    start_sweeper()

# ========================================
# Utility Functions
# ========================================

def safe_download_path(download_id):
    """
    Validate download_id and return a safe path within TEMP_DIR.
    Prevents path traversal attacks (S2083).
    Returns the safe path or None if the download_id is invalid.
    """
    # uuid4().hex: exactamente 32 caracteres hexadecimales (plan 02, T7)
    if not re.fullmatch(r'[a-f0-9]{32}', download_id):
        return None
    # Construct and resolve the path, then verify it's inside TEMP_DIR
    candidate = os.path.realpath(os.path.join(TEMP_DIR, download_id))
    if not candidate.startswith(os.path.realpath(TEMP_DIR) + os.sep):
        return None
    return candidate

# Hosts que se aceptan como YouTube. La comprobación se hace contra el host
# real de la URL, no buscando una subcadena (plan 02, T9).
YOUTUBE_HOSTS = frozenset({
    'youtube.com', 'www.youtube.com', 'm.youtube.com',
    'music.youtube.com', 'youtu.be', 'www.youtu.be',
})


def is_youtube_host(url):
    """
    True si la URL apunta realmente a un host de YouTube por http(s).

    Antes se usaba re.search() sobre la cadena entera, que encuentra el patrón
    en cualquier posición: `https://evil.com/?x=youtube.com/watch?v=<id>` pasaba
    la validación y la URL completa del atacante acababa como argumento de
    yt-dlp, haciendo que el servidor descargase de donde le dijeran (SSRF).
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False

    if parsed.scheme not in ('http', 'https'):
        return False

    return (parsed.hostname or '').lower() in YOUTUBE_HOSTS


def resolve_audio_format(data):
    """
    Devuelve el formato pedido si está permitido. Lanza ValueError si no.

    `quality` se acepta y se descarta a propósito: una APK antigua sin
    actualizar lo sigue mandando, y ya se ignoraba de hecho.
    """
    fmt = str((data or {}).get('format', DEFAULT_AUDIO_FORMAT)).lower().strip()
    if fmt not in AUDIO_FORMATS:
        raise InvalidInputError(f'Formato de audio no soportado: {fmt}')
    return fmt


def validate_youtube_url(url):
    """
    Validates if the given URL is a valid YouTube URL
    Returns the type of content (video, playlist, shorts) or None if invalid
    """
    # El host tiene que ser de YouTube de verdad antes de mirar el patrón
    if not is_youtube_host(url):
        return None, None

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
    except OSError:
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

# Las rutas que sirven la propia interfaz están exentas del límite general de
# peticiones. Cada carga de la página pide media docena de ficheros, y con el
# límite de 200 por hora e IP bastaban unas treinta recargas para bloquear la
# web; en redes móviles, donde muchos usuarios comparten IP, se agotaba entre
# todos. Son ficheros estáticos: el límite protege las rutas que cuestan CPU.

@app.route('/', methods=['GET'])
@limiter.exempt
def index():
    """Serve the frontend, prefer dist/ built by Vite"""
    for folder in ['dist', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'index.html')
        if os.path.exists(path):
            return send_file(path)
    return jsonify({'error': 'Frontend no compilado. Ejecuta npm run build'}), 404


@app.route('/download', methods=['GET'])
@limiter.exempt
def download_page():
    """Serve the APK download landing page, prefer dist/ built by Vite"""
    for folder in ['dist', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'download.html')
        if os.path.exists(path):
            return send_file(path)
    return jsonify({'error': 'Página de descarga no encontrada'}), 404


@app.route('/sw.js', methods=['GET'])
@limiter.exempt
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
@limiter.exempt
def serve_manifest():
    """Serve manifest.json with correct headers from public/ or dist/"""
    for folder in ['dist', 'public', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'manifest.json')
        if os.path.exists(path):
            return send_file(path, mimetype='application/json')
    return jsonify({'error': 'manifest.json no encontrado'}), 404


@app.route('/favicon.png', methods=['GET'])
@limiter.exempt
def serve_favicon():
    """Serve favicon.png from public/ or dist/"""
    for folder in ['dist', 'public', '.']:
        path = os.path.join(SCRIPT_DIR, folder, 'favicon.png')
        if os.path.exists(path):
            return send_file(path, mimetype='image/png')
    return jsonify({'error': 'favicon.png no encontrado'}), 404


@app.route('/assets/<path:filename>', methods=['GET'])
@limiter.exempt
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


# Ficheros del proyecto que sí deben servirse públicamente.
# Lista blanca, no negra: lo que no esté aquí no se sirve, así que añadir un
# fichero nuevo al repositorio no vuelve a abrir el agujero de T0.
PUBLIC_FILES = frozenset({
    'app.js',            # index.html sin build de Vite
    'styles.css',        # ídem
    'Sortable.min.js',   # index.html
    'ytmusic.apk',       # download.html e index.html
})


@app.route('/<path:filename>', methods=['GET'])
@limiter.exempt
def serve_public_file(filename):
    """Sirve únicamente los ficheros enumerados en PUBLIC_FILES."""
    if filename not in PUBLIC_FILES:
        return jsonify({'error': 'No encontrado'}), 404

    for folder in ['dist', '.']:
        path = os.path.join(SCRIPT_DIR, folder, filename)
        if os.path.isfile(path):
            return send_file(path)
    return jsonify({'error': 'No encontrado'}), 404


@app.route('/api/stream/<download_id>', methods=['GET'])
@limiter.exempt
def stream_file(download_id):
    """Sirve un fichero recién descargado, con soporte de Range.

    CONTRATO: es un recurso TEMPORAL. La carpeta se borra cuando el cliente
    recoge el fichero por /api/download/<id>, y en cualquier caso al cabo de
    DOWNLOAD_TTL_SECONDS. NO es almacenamiento: el cliente debe persistir el
    audio por su cuenta (Filesystem en nativo, IndexedDB en web).

    El identificador es un download_id, NUNCA un videoId de YouTube.
    """
    try:
        # Misma validación que el resto de rutas (plan 03, T3)
        target_dir_path = safe_download_path(download_id)
        if target_dir_path is None:
            return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400

        target_dir = Path(target_dir_path)
        files = []
        if target_dir.exists():
            files = [f for f in target_dir.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS]

        target_file = files[0] if files else None
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

        # Rango fuera del fichero: 416, como manda el estándar (plan 03, T3)
        if byte1 < 0 or byte1 >= file_size:
            return Response(
                status=416,
                headers={'Content-Range': f'bytes */{file_size}', 'Accept-Ranges': 'bytes'},
            )

        length = file_size - byte1
        if byte2 is not None:
            length = byte2 + 1 - byte1

        # Techo por respuesta: f.read(length) con `Range: bytes=0-` reservaba el
        # fichero entero en memoria del proceso, y con varias peticiones a la vez
        # eso se multiplica. El reproductor pide el siguiente rango sin enterarse.
        length = max(0, min(length, MAX_RANGE_CHUNK, file_size - byte1))

        with open(target_file, 'rb') as f:
            f.seek(byte1)
            data = f.read(length)

        rv = Response(data, 206, mimetype=MIMETYPE_AUDIO_MPEG, content_type=MIMETYPE_AUDIO_MPEG, direct_passthrough=True)
        rv.headers.add('Content-Range', f'bytes {byte1}-{byte1 + length - 1}/{file_size}')
        rv.headers.add('Accept-Ranges', 'bytes')
        return rv

    except OSError:
        app.logger.exception("Streaming error")
        return jsonify({'error': 'Error al servir el fichero'}), 500


@app.route('/api/health', methods=['GET'])
@limiter.exempt
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api/search', methods=['POST'])
@limiter.limit("20 per minute")
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
        result = subprocess.run(  # noqa: S603 - lista de argumentos, sin shell; entrada validada
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
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        app.logger.exception("Search error")
        return jsonify({'error': 'Error al buscar en YouTube'}), 500


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
@limiter.limit("10 per minute")
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
        result = subprocess.run(  # noqa: S603 - lista de argumentos, sin shell; entrada validada
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
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        app.logger.exception("Playlist info error")
        return jsonify({'error': 'Error al obtener información de la playlist'}), 500


@app.route('/api/progress/<download_id>', methods=['GET'])
@limiter.exempt
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


# ========================================
# Progreso por SSE (plan 07, T1)
# ========================================

SSE_MAX_DURATION = 35 * 60          # un poco más que DOWNLOAD_TIMEOUT
SSE_POLL_INTERVAL = 0.5
SSE_MAX_CONNECTIONS = 40
TERMINAL_STATUSES = ('complete', 'error', 'cancelled')

_sse_connections = threading.Semaphore(SSE_MAX_CONNECTIONS)


def format_sse(payload):
    """Serializa un evento en el formato que espera EventSource."""
    return f"data: {json.dumps(payload)}\n\n"


@app.route('/api/progress/stream/<download_id>', methods=['GET'])
@limiter.exempt
def stream_progress(download_id):
    """
    Progreso en tiempo real por Server-Sent Events.

    Sustituye al sondeo de /api/progress/<id>, que se mantiene intacto como
    respaldo: si esto falla por cualquier motivo, el cliente vuelve a sondear.
    """
    if safe_download_path(download_id) is None:
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400

    if not _sse_connections.acquire(blocking=False):
        # Sin hueco libre: el cliente debe caer al sondeo, no esperar
        return jsonify({'error': 'Demasiadas conexiones', 'code': 'sse_unavailable'}), 503

    def generate():
        started = time.time()
        last_payload = None
        try:
            while time.time() - started < SSE_MAX_DURATION:
                with download_lock:
                    progress = download_progress.get(download_id)
                    snapshot = dict(progress) if progress else None

                if snapshot is None:
                    yield format_sse({'status': 'unknown', 'message': 'Download not found'})
                    return

                # Solo se emite cuando algo cambia, no cada medio segundo
                payload = json.dumps(snapshot, sort_keys=True, default=str)
                if payload != last_payload:
                    last_payload = payload
                    yield format_sse(snapshot)

                if snapshot.get('status') in TERMINAL_STATUSES:
                    return

                time.sleep(SSE_POLL_INTERVAL)
        finally:
            # Crítico: sin esto, un cliente que corta abruptamente se queda con
            # un hueco reservado para siempre y el semáforo se agota solo.
            _sse_connections.release()

    response = Response(generate(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    # Sin esta cabecera nginx acumula la respuesta y el cliente no recibe nada
    # hasta el final, que es exactamente lo contrario del objetivo.
    response.headers['X-Accel-Buffering'] = 'no'
    # `Connection` NO se toca: es una cabecera hop-by-hop y el estándar WSGI
    # prohíbe que la aplicación la fije. Ponerla a keep-alive hacía que el
    # navegador reutilizase la conexión del flujo para la siguiente petición,
    # y esa petición se quedaba colgada sin respuesta. Detectado con Playwright.
    return response


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
    
    # Avisar a los hilos en curso antes de desmontar nada
    if download_id in download_cancellation:
        download_cancellation[download_id].set()

    db.complete_download_event(download_id, status='cancelled')

    # forget_download mata el proceso y limpia los tres diccionarios y la
    # carpeta en un solo sitio (plan 03, T4). Antes estaba repartido y se
    # dejaba siempre alguna estructura sin limpiar.
    forget_download(download_id)

    app.logger.info(f"Download {download_id} cancelled successfully")
    return jsonify({'status': 'cancelled', 'message': 'Download cancelled'})


def download_single_item(video_info, output_folder, audio_format=DEFAULT_AUDIO_FORMAT):
    """Download a single video as audio. Returns (success, title)."""
    try:
        url = video_info.get('url', '')
        title = video_info.get('title', 'video')

        cmd = build_ytdlp_audio_cmd(url, audio_format, single=True, batch_item=True)

        # Solo mp3 pasa por ffmpeg; m4a se remuxea y no compite por CPU.
        limitador = transcode_slots if audio_format == 'mp3' else contextlib.nullcontext()

        start_time = time.time()
        with limitador:
            proc = subprocess.run(  # noqa: S603 - lista de argumentos, sin shell; entrada validada
                cmd,
                cwd=output_folder,
                capture_output=True,
                timeout=600,
                encoding='utf-8',
                errors='replace'
            )
        duration = time.time() - start_time
        app.logger.debug(f"Descarga de {url} en {duration:.2f}s")
        
        if proc.returncode == 0:
            app.logger.info(f"Descargado: {title}")
            return (True, title)

        app.logger.error(f"Fallo descargando {title}: {proc.stderr}")
        return (False, None)
            
    except (subprocess.SubprocessError, OSError):
        app.logger.exception(f"Fallo descargando {video_info.get('url', '')}")
        return (False, None)


def run_parallel_batch(videos, download_folder, audio_format, download_id, total_count):
    """Coordinate parallel batch download in a background thread."""
    try:
        completed_count = 0
        
        futures = []
        for video in videos:
            futures.append(executor.submit(download_single_item, video, download_folder, audio_format))
        
        for i, future in enumerate(concurrent.futures.as_completed(futures)):
            try:
                success, title = future.result()
                if success:
                    completed_count += 1
            except (subprocess.SubprocessError, OSError):
                app.logger.exception("Fallo en una descarga del lote")
            
            current_done = i + 1
            percent = int((current_done / total_count) * 100)
            msg = f'Procesando: {current_done}/{total_count} ({percent}%)'
            
            update_progress(
                download_id, status='downloading',
                current=current_done, total=total_count, message=msg,
                code='downloading_n_of_m',
                params={'current': current_done, 'total': total_count},
            )
        
        was_cancelled = download_id in download_cancellation and download_cancellation[download_id].is_set()
        final_files_count = count_downloaded_files(download_folder)
        app.logger.info(f"Batch parallel download complete: {final_files_count} files, cancelled: {was_cancelled}")
        
        if final_files_count > 0 and not was_cancelled:
            if final_files_count > 1:
                update_progress(download_id, message='Creando archivo ZIP...',
                                code='zipping', params={})

            db.complete_download_event(download_id, status='complete')
            update_progress(
                download_id, status='complete',
                current=final_files_count, total=total_count,
                message=f'¡Completado! {final_files_count} archivos descargados.',
                code='batch_complete',
                params={'count': final_files_count},
            )
        else:
            db.complete_download_event(download_id, status='error')
            update_progress(
                download_id, status='error', current=0, total=total_count,
                message='No se pudo descargar ninguna canción (error general)',
                code='error_none',
                params={},
            )
                
    except Exception as e:
        # Captura amplia deliberada: frontera de hilo. Si esta función deja
        # escapar una excepción, el hilo muere en silencio y el cliente se queda
        # sondeando un progreso que ya nunca cambia.
        app.logger.exception("Batch parallel error")
        download_progress[download_id] = {
            'status': 'error',
            'current': 0,
            'total': total_count,
            'message': f'Error fatal: {str(e)}'
        }


@app.route('/api/start-batch-download', methods=['POST'])
@limiter.limit("3 per minute;20 per hour")
def start_batch_download():
    """Start batch download for multiple videos from a playlist in parallel"""
    app.logger.info("Batch download requested")
    data = request.get_json()
    
    if not data or 'videos' not in data:
        return jsonify({'error': 'No se proporcionaron videos'}), 400
    
    videos = data['videos']
    if not videos or len(videos) == 0:
        return jsonify({'error': 'La lista de videos está vacía'}), 400

    if len(videos) > MAX_BATCH_VIDEOS:
        return jsonify({'error': f'Máximo {MAX_BATCH_VIDEOS} canciones por lote'}), 400
    
    try:
        audio_format = resolve_audio_format(data)
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400

    # Create unique download ID
    download_id = uuid.uuid4().hex
    download_folder = os.path.join(TEMP_DIR, download_id)
    os.makedirs(download_folder, exist_ok=True)
    
    total_count = len(videos)
    
    register_download(
        download_id, total_count,
        message=f'Iniciando descarga paralela de {total_count} canciones...',
        code='starting',
        params={},
        format=audio_format,
    )
    
    usuario = get_current_user()
    db.log_download_started(
        download_id,
        title=f'Lote de {total_count} canciones',
        content_type='batch',
        total_items=total_count,
        user_id=usuario['id'] if usuario else None,
    )

    # Pool acotado en vez de un hilo por petición (plan 02, T5)
    batch_executor.submit(
        run_parallel_batch, videos, download_folder, audio_format, download_id, total_count
    )
    
    return jsonify({
        'download_id': download_id,
        'total': total_count,
        'format': audio_format
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
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')  # noqa: S603 - lista de argumentos, sin shell; entrada validada
        
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
    except (subprocess.SubprocessError, OSError, ValueError):
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
        raise InvalidInputError('URL de YouTube no válida')

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
        meta_result = subprocess.run(  # noqa: S603 - lista de argumentos, sin shell; entrada validada
            [
                sys.executable, '-m', 'yt_dlp',
                '--dump-json', '--no-playlist', '--no-warnings',
                '--js-runtimes', 'node',
                # yt-dlp necesita el componente EJS remoto para resolver los desafíos JS
        # del reproductor de YouTube. Decisión consciente (plan 02, T6, medida el
        # 2026-09-21): sin la bandera, yt-dlp avisa de que su "challenge solver"
        # empaquetado es la versión 0.4.0 y la soportada es la 0.8.0. Se mantiene.
        # Revisar en cada actualización de yt-dlp.
        # Se mantiene a propósito: ver la nota de la decisión (plan 02, T6) arriba.
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
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as e:
        app.logger.warning(f"Could not fetch metadata: {e}")


def audio_format_args(audio_format):
    """
    Argumentos de yt-dlp específicos del formato de salida.

    m4a remuxea sin re-codificar: calidad intacta y coste de CPU cero.
    mp3 sí re-codifica, y por eso lleva semáforo (ver MAX_TRANSCODES).
    """
    if audio_format == 'mp3':
        # La fuente es AAC de unos 128 kbps, así que V2 (~190 kbps VBR) sobra.
        # V0 solo inflaría el fichero sin ganar calidad audible.
        return ['-f', 'bestaudio', '--audio-format', 'mp3', '--audio-quality', '2']
    return ['-f', 'bestaudio[ext=m4a]/bestaudio', '--audio-format', 'm4a', '--audio-quality', '0']


def build_ytdlp_audio_cmd(target, audio_format=DEFAULT_AUDIO_FORMAT, *,
                          single=True, batch_item=False):
    """
    Constructor único de comandos de descarga de audio (plan 05, T1).

    Antes había dos listas de argumentos casi idénticas, y fue esa duplicación
    la que dejó `audio_quality` sin conectar en la ruta de lote. Las diferencias
    que sí son intencionadas entre ambas se conservan mediante `batch_item`.
    """
    cmd = [
        sys.executable, '-m', 'yt_dlp',
        '--no-check-certificates',
    ]

    if batch_item:
        cmd += ['--user-agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36']

    cmd += ['-x', *audio_format_args(audio_format)]

    cmd += [
        '--embed-thumbnail',
        '--add-metadata',
        '-o', '%(title)s.%(ext)s',
        '--ffmpeg-location', FFMPEG_PATH,
        '--ignore-errors',
    ]

    if batch_item:
        cmd.append('--no-warnings')
    else:
        cmd += [
            '--encoding', 'utf-8',
            '--js-runtimes', 'node',
            # Decisión consciente (plan 02, T6): sin esta bandera yt-dlp avisa de
            # que su resolutor de desafíos JS empaquetado está desactualizado.
            # Revisar en cada actualización de yt-dlp.
            '--remote-components', 'ejs:github',
            '--print', 'after_video:DOWNLOAD_LOG_TITLE:%(title)s',
        ]

    if single:
        cmd.append('--no-playlist')

    cmd.append(target)
    return cmd


def build_ytdlp_download_cmd(content_type, search_query, audio_format=DEFAULT_AUDIO_FORMAT):
    """Comando para la ruta de descarga simple o de playlist."""
    return build_ytdlp_audio_cmd(
        search_query, audio_format, single=(content_type != 'playlist')
    )


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
            'message': f'Descargando... {current_count} de {total_count} canciones',
            'code': 'downloading_n_of_m',
            'params': {'current': current_count, 'total': total_count},
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
        update_progress(
            download_id,
            message=format_download_status(percent_str, speed_str, eta_str),
            code='downloading_pct',
            params={'percent': percent_str, 'speed': speed_str, 'eta': eta_str},
            percent=percent_str,
        )
    except (ValueError, IndexError, KeyError, TypeError, AttributeError) as e:
        # Nivel debug a propósito: yt-dlp emite líneas raras a menudo y no
        # queremos ruido. Pero algo tiene que quedar registrado: antes esto era
        # un `pass` mudo, y un cambio de formato de yt-dlp congelaba la barra de
        # progreso sin dejar ni una pista.
        app.logger.debug(f"Línea de progreso no parseable ({e}): {line!r}")


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
        final_code, final_params = 'complete_n', {'count': final_count}
    else:
        final_status = 'error'
        final_msg = 'No se pudo descargar ninguna canción'
        final_code, final_params = 'error_none', {}
        if proc.returncode != 0:
            final_msg += f" (Código {proc.returncode})"

    update_progress(
        download_id,
        status=final_status,
        current=final_count,
        total=total_count if total_count > 0 else final_count,
        message=final_msg,
        code=final_code,
        params=final_params,
    )

    # Cerrar el evento de uso. El título solo se conoce con seguridad al final,
    # porque en las búsquedas no se sabe qué vídeo va a resolver yt-dlp.
    db.complete_download_event(
        download_id,
        status=final_status,
        title=download_progress.get(download_id, {}).get('title') or infer_title_from_folder(download_folder),
    )


def run_download_task(download_id, content_type, search_query, total_count,
                      audio_format=DEFAULT_AUDIO_FORMAT):
    """Background task: build command, launch yt-dlp, monitor, and finalize."""
    download_folder = os.path.join(TEMP_DIR, download_id)

    try:
        cmd = build_ytdlp_download_cmd(content_type, search_query, audio_format)
        app.logger.info(f"Running command: {' '.join(cmd[:5])}...")

        stop_monitor = threading.Event()
        monitor_thread = threading.Thread(
            target=monitor_download_files,
            args=(stop_monitor, download_folder, download_id, total_count),
            daemon=True
        )
        monitor_thread.start()

        proc = subprocess.Popen(  # noqa: S603 - lista de argumentos, sin shell; entrada validada
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
        # Captura amplia deliberada: frontera de hilo (ver run_parallel_batch).
        app.logger.exception("Download error")
        update_progress(download_id, status='error', message=f"Error interno: {str(e)}")
    finally:
        # El proceso ya ha terminado; solo se suelta la referencia. La entrada
        # de progreso se conserva para que el cliente pueda recogerla.
        with download_lock:
            download_processes.pop(download_id, None)


@app.route('/api/start-download', methods=['POST'])
@limiter.limit("10 per minute;100 per hour")
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
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400

    try:
        audio_format = resolve_audio_format(data)
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400

    download_id = uuid.uuid4().hex
    download_folder = os.path.join(TEMP_DIR, download_id)
    os.makedirs(download_folder, exist_ok=True)

    register_download(
        download_id, total_count,
        video_id=content_id if content_type == 'video' else None,
        format=audio_format,
    )

    if content_type == 'video':
        prefetch_video_metadata(search_query, download_id)

    # Registro de uso: TODAS las descargas, con sesión o sin ella.
    # download_history solo recoge las de usuarios autenticados, que son una
    # minoría, así que no servía para saber si la aplicación tiene uso real.
    usuario = get_current_user()
    db.log_download_started(
        download_id,
        video_id=content_id or '',
        title=download_progress[download_id].get('title', ''),
        content_type=content_type,
        total_items=total_count,
        user_id=usuario['id'] if usuario else None,
    )

    executor.submit(run_download_task, download_id, content_type, search_query,
                    total_count, audio_format)

    return jsonify({
        'download_id': download_id,
        'total': total_count,
        'format': audio_format,
        'title': download_progress[download_id].get('title'),
        'thumbnail': download_progress[download_id].get('thumbnail')
    })


@app.route('/api/download/<download_id>', methods=['GET'])
@limiter.exempt
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
            forget_download(download_id)

        return response
    
    # Multiple files - create ZIP
    app.logger.info(f"Creating ZIP for {len(downloaded_files)} files...")
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_name = f"youtube_playlist_{timestamp}"
    
    try:
        zip_path = create_zip_from_folder(download_folder, zip_name)
        app.logger.info(f"ZIP created at: {zip_path}")
    except (OSError, zipfile.BadZipFile):
        app.logger.exception("Error creating ZIP")
        cleanup_temp_folder(download_folder)
        return jsonify({'error': 'Error al crear el archivo ZIP'}), 500
    
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
        forget_download(download_id)

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
        except OSError:
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
@limiter.limit("10 per minute")
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
        
    except ValueError:
        # id_token.verify_oauth2_token lanza ValueError si el token no es válido
        app.logger.info("Token de Google rechazado")
        return jsonify({'error': 'Invalid Google token'}), 401
    except Exception:
        # Frontera con servicios externos (Google) y con SQLite: un fallo aquí
        # es interno, no culpa del usuario, y debe devolver 500 y no 401.
        app.logger.exception("Fallo interno verificando el token de Google")
        return jsonify({'error': 'Error interno'}), 500


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
@limiter.limit("10 per minute")
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
        
    except ValueError:
        app.logger.info("Token de Google rechazado (nativo)")
        return 'Token invalido', 401
    except Exception:
        # Misma frontera que el flujo web: fallo interno, no token inválido.
        app.logger.exception("Fallo interno verificando el token de Google (nativo)")
        return 'Error interno', 500


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


@app.errorhandler(429)
def ratelimit_handler(e):
    """Mismo formato de error que el resto de la API, para que el cliente lo muestre."""
    return jsonify({'error': 'Demasiadas peticiones. Espera un momento.'}), 429


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Error interno del servidor'}), 500


# ========================================
# Main Entry Point
# ========================================

# Inicialización a nivel de módulo: corre también bajo gunicorn/WSGI, donde el
# bloque __main__ no se ejecuta (plan 03, T6).
bootstrap()


if __name__ == '__main__':
    # =========================================================================
    # SOLO DESARROLLO. En producción se sirve con gunicorn y este bloque no se
    # ejecuta (por eso bootstrap() está a nivel de módulo, plan 03 T6).
    #
    # La unidad de systemd debe usar UN SOLO worker (plan 04, T4):
    #
    #   ExecStart=.../.venv/bin/gunicorn \
    #       --workers 1 --threads 8 \
    #       --timeout 120 --graceful-timeout 30 \
    #       --bind 127.0.0.1:5000 \
    #       --access-logfile - --error-logfile - \
    #       server:app
    #
    # --workers 1 NO es una preferencia, es un requisito: el estado vive en
    # memoria del proceso (download_progress, download_cancellation,
    # download_processes, los contadores de flask-limiter y el hilo de barrido).
    # Con varios workers, una petición de progreso puede caer en un worker que
    # no conoce esa descarga y devolver 404. Los hilos dan la concurrencia.
    # =========================================================================
    print("""
    +-----------------------------------------------------------+
    |         YouTube Music Downloader - Backend Server         |
    +-----------------------------------------------------------+
    |  Servidor de DESARROLLO en: http://localhost:5000         |
    |  En producción se usa gunicorn (ver comentario arriba)     |
    +-----------------------------------------------------------+
    """)

    # El puerto es configurable para que los recorridos end-to-end puedan
    # levantar una instancia aparte sin chocar con un servidor de desarrollo.
    app.run(
        host=os.environ.get('HOST', '0.0.0.0'),  # noqa: S104 - solo desarrollo; en producción gunicorn usa 127.0.0.1
        port=int(os.environ.get('PORT', '5000')),
        debug=False,
        threaded=True
    )
