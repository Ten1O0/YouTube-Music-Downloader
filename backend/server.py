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
import importar
import lotes as lotes_mod
import pico as pico_mod
import radio as radio_mod
from listas_youtube import ListaNoDisponible, MAX_CANCIONES_AL_SEGUIR, leer_lista, leer_salida, lista_de

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

# Ninguna petición necesita más: la mayor, una sincronización de 500 cambios
# (plan 13). Flask responde 413 por su cuenta a lo que se pase.
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024

# Rate limiting por IP. /api/progress queda exento porque el cliente lo sondea
# cada segundo durante toda la descarga (se revisará cuando el plan 07 lo
# sustituya por SSE).
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per hour"],
    storage_uri="memory://",
    strategy="fixed-window",
    # Solo para los recorridos E2E, que descargan más de 10 canciones por
    # minuto desde la misma IP. En producción esta variable no existe.
    enabled=os.environ.get('YTDL_DISABLE_RATELIMIT') != '1',
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
# Las Mix (RD…) no acaban: YouTube sirve cientos de canciones (719 medidas en
# una, en 23 s). El selector y la descarga directa se quedan con las primeras.
MAX_CANCIONES_MIX = 35
# Una lista pedida entera a /api/start-download, como mucho lo que cabe en un lote
MAX_CANCIONES_LISTA = MAX_BATCH_VIDEOS
TIMEOUT_RECUENTO = 60


# Preparados para un pico de visitas (plan 21, T7): el tope global de
# canciones por hora y el enfriamiento cuando YouTube limita al servidor
pico = pico_mod.Pico()


def respuesta_de_pico(e):
    """La respuesta para el cliente cuando el pico no deja empezar una descarga."""
    if isinstance(e, pico_mod.YoutubeLimita):
        return jsonify({'error': 'YouTube está limitando las descargas. Prueba en un rato.',
                        'code': 'youtube_limit'}), 503
    return jsonify({'error': 'Hay muchas descargas en marcha. Prueba en un rato.',
                    'code': 'server_busy'}), 429


def youtube_limita(salida):
    """Si la salida de yt-dlp dice que YouTube limita al servidor, lo apunta. Devuelve si es así."""
    if not pico_mod.es_bloqueo(salida):
        return False
    pico.bloqueo()
    app.logger.warning("YouTube está limitando al servidor: sin descargas nuevas durante "
                       f"{pico_mod.ENFRIAMIENTO_SEGUNDOS // 60} minutos")
    return True


def tope_de_lista(lista_id):
    """Cuántas canciones de una lista se leen o se descargan de una vez."""
    return MAX_CANCIONES_MIX if (lista_id or '').startswith('RD') else MAX_CANCIONES_LISTA

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

# Rutas del proyecto. server.py vive en backend/; lo que sirve está fuera:
# la web compilada en dist/ y la APK en releases/
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(SCRIPT_DIR)
DIST_DIR = os.path.join(RAIZ, 'dist')
PUBLIC_DIR = os.path.join(RAIZ, 'frontend', 'public')
APK_PATH = os.path.join(RAIZ, 'releases', 'ytmusic.apk')

# FFmpeg Configuration - Cross-platform support
IS_WINDOWS = sys.platform.startswith('win')

if IS_WINDOWS:
    FFMPEG_DIR = os.path.join(RAIZ, 'ffmpeg-master-latest-win64-gpl', 'bin')
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
# Lo terminado y sin recoger aguanta un día (plan 14, T2): si el cliente se
# cerró a mitad de un lote, lo recoge al volver en lugar de perderlo
COMPLETED_TTL_SECONDS = 24 * 3600
SWEEP_INTERVAL_SECONDS = 600             # barrido cada 10 minutos
# 'queued': una canción de un lote que espera su turno (plan 20); el barrido no la toca
ACTIVE_STATUSES = ('queued', 'starting', 'downloading')

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
            if p.get('status') not in ACTIVE_STATUSES
            and now - p.get('updated_at', p.get('created_at', 0)) > (
                COMPLETED_TTL_SECONDS if p.get('status') == 'complete' else DOWNLOAD_TTL_SECONDS)
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

    ultima_purga = 0.0

    def loop():
        nonlocal ultima_purga
        while True:
            time.sleep(SWEEP_INTERVAL_SECONDS)
            try:
                n = sweep_stale_downloads() + sweep_orphan_folders() + gestor_lotes.barrer()
                if n:
                    app.logger.info(f"Barrido: {n} elementos liberados")
                # Las lápidas de la sincronización (plan 13), una vez al día
                if time.time() - ultima_purga > 24 * 3600:
                    ultima_purga = time.time()
                    purgadas = db.purgar_lapidas()
                    if purgadas:
                        app.logger.info(f"Barrido: {purgadas} lápidas de sincronización purgadas")
                    # Y el registro de descargas, a los 90 días (plan 21, T6: la privacidad)
                    eventos = db.purgar_eventos()
                    if eventos:
                        app.logger.info(f"Barrido: {eventos} eventos de descarga de más de {db.DIAS_EVENTOS} días borrados")
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



def metadatos_musicales(video):
    """
    Artista y canción cuando YouTube los sabe (plan 11, T1).

    Los temas de canales oficiales y de los «- Topic» traen `artists`/`artist` y
    `track` en el JSON de yt-dlp; la mayoría de vídeos, no. Solo se devuelven
    los que existen: el cliente deduce el resto del título.
    """
    datos = {}
    artistas = video.get('artists') or []
    artista = (artistas[0] if isinstance(artistas, list) and artistas else None) \
        or video.get('artist') or video.get('creator')
    if isinstance(artista, str) and artista.strip():
        # «A, B» → el principal; los demás ya suelen ir en el título como «feat.»
        datos['artist'] = artista.split(',')[0].strip()[:200]
    cancion = video.get('track')
    if isinstance(cancion, str) and cancion.strip():
        datos['track'] = cancion.strip()[:200]
    return datos


def parse_video_json_output(output):
    """Parse yt-dlp JSON output (one JSON object per line) into video info dicts."""
    videos = []
    # Las Mix a veces repiten canción: cada una, una sola vez
    vistos = set()
    for line in output.strip().split('\n'):
        if not line:
            continue
        try:
            video = json.loads(line)
            video_id = video.get('id', '')
            if video_id and video_id not in vistos:
                vistos.add(video_id)
                videos.append({
                    'id': video_id,
                    'title': video.get('title', 'Sin título'),
                    'thumbnail': f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
                    'duration': video.get('duration', 0),
                    'channel': video.get('channel', video.get('uploader', 'Canal desconocido')),
                    'url': f"https://www.youtube.com/watch?v={video_id}",
                    **metadatos_musicales(video),
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
    """Sirve la web compilada por Vite. Sin build no hay web: el código fuente
    son módulos que el navegador no puede cargar tal cual."""
    path = os.path.join(DIST_DIR, 'index.html')
    if os.path.exists(path):
        return send_file(path)
    return jsonify({'error': 'Frontend no compilado. Ejecuta npm run build'}), 404


@app.route('/download', methods=['GET'])
@limiter.exempt
def download_page():
    """Sirve la página de la APK, compilada por Vite."""
    path = os.path.join(DIST_DIR, 'download.html')
    if os.path.exists(path):
        return send_file(path)
    return jsonify({'error': 'Página de descarga no encontrada'}), 404


@app.route('/privacidad', methods=['GET'])
@limiter.exempt
def privacy_page():
    """La política de privacidad (plan 21, T6), compilada por Vite."""
    path = os.path.join(DIST_DIR, 'privacidad.html')
    if os.path.exists(path):
        return send_file(path)
    return jsonify({'error': 'Página de privacidad no encontrada'}), 404


@app.route('/sw.js', methods=['GET'])
@limiter.exempt
def service_worker():
    """Serve the Service Worker with correct headers from public/ or dist/"""
    target_path = None
    for folder in (DIST_DIR, PUBLIC_DIR):
        path = os.path.join(folder, 'sw.js')
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
    for folder in (DIST_DIR, PUBLIC_DIR):
        path = os.path.join(folder, 'manifest.json')
        if os.path.exists(path):
            return send_file(path, mimetype='application/json')
    return jsonify({'error': 'manifest.json no encontrado'}), 404


@app.route('/favicon.png', methods=['GET'])
@limiter.exempt
def serve_favicon():
    """Serve favicon.png from public/ or dist/"""
    for folder in (DIST_DIR, PUBLIC_DIR):
        path = os.path.join(folder, 'favicon.png')
        if os.path.exists(path):
            return send_file(path, mimetype='image/png')
    return jsonify({'error': 'favicon.png no encontrado'}), 404


@app.route('/assets/<path:filename>', methods=['GET'])
@limiter.exempt
def serve_assets(filename):
    """Serve static assets built by Vite inside dist/assets"""
    try:
        file_path = safe_join(os.path.join(DIST_DIR, 'assets'), filename)
        if file_path and os.path.isfile(file_path):
            return send_file(file_path)
    except ValueError:
        # safe_join raises ValueError if the path goes outside dist/assets
        pass
    return jsonify({'error': 'Asset no encontrado'}), 404


# Ficheros del proyecto que sí deben servirse públicamente.
# Lista blanca, no negra: lo que no esté aquí no se sirve, así que añadir un
# fichero nuevo al repositorio no vuelve a abrir el agujero de T0.
PUBLIC_FILES = frozenset({
    'Sortable.min.js',   # index.html
    'ytmusic.apk',       # download.html e index.html
})

# Dónde está cada uno. La APK no pasa por Vite: si estuviera en dist/, la APK
# se llevaría dentro una copia de sí misma al copiar dist/ a mobile/www/
UBICACION_PUBLICA = {
    'Sortable.min.js': (os.path.join(DIST_DIR, 'Sortable.min.js'), os.path.join(PUBLIC_DIR, 'Sortable.min.js')),
    'ytmusic.apk': (APK_PATH,),
}


@app.route('/<path:filename>', methods=['GET'])
@limiter.exempt
def serve_public_file(filename):
    """Sirve únicamente los ficheros enumerados en PUBLIC_FILES."""
    if filename not in PUBLIC_FILES:
        return jsonify({'error': 'No encontrado'}), 404

    for path in UBICACION_PUBLICA[filename]:
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


def componer_version(datos):
    """
    El fichero guarda el historial de versiones con sus novedades, de la más
    nueva a la más antigua. La respuesta lleva además, arriba, los campos de la
    última (versionCode, versionName, fecha, novedades): es lo que leen las APK
    ya instaladas, anteriores a este formato, y la página de descarga.
    """
    if not isinstance(datos, dict):
        return datos
    historial = [v for v in datos.get('historial', [])
                 if isinstance(v, dict) and isinstance(v.get('versionCode'), int) and v.get('versionName')]
    if not historial:
        return datos
    historial.sort(key=lambda v: v['versionCode'], reverse=True)
    ultima = historial[0]
    return {
        **{k: v for k, v in datos.items() if k != 'historial'},
        'versionCode': ultima['versionCode'],
        'versionName': ultima['versionName'],
        'fecha': ultima.get('fecha', ''),
        'novedades': ultima.get('novedades', {}),
        'historial': historial,
    }


@app.route('/api/app/version', methods=['GET'])
def app_version():
    """
    Última versión de la APK y sus novedades, para el aviso de actualización.

    La APK lleva la web dentro y no se actualiza al desplegar: al arrancar
    pregunta aquí si hay una más nueva. La fuente es frontend/public/app-version.json,
    que Vite copia a dist/ y se despliega con el resto.
    """
    for folder in (DIST_DIR, PUBLIC_DIR):
        ruta = os.path.join(folder, 'app-version.json')
        if os.path.isfile(ruta):
            try:
                with open(ruta, encoding='utf-8') as f:
                    datos = json.load(f)
            except (OSError, ValueError):
                app.logger.error('app-version.json ilegible')
                break
            respuesta = jsonify(componer_version(datos))
            # Cinco minutos: un despliegue se nota enseguida sin pedirlo en cada arranque
            respuesta.headers['Cache-Control'] = 'public, max-age=300'
            return respuesta
    return jsonify({'error': 'Versión no disponible'}), 404


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
            if youtube_limita(result.stderr):
                return respuesta_de_pico(pico_mod.YoutubeLimita())
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
        cmd.extend(['--playlist-end', str(MAX_CANCIONES_MIX)])

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
            if youtube_limita(result.stderr):
                return respuesta_de_pico(pico_mod.YoutubeLimita())
            return jsonify({'error': 'Error al obtener información de la playlist'}), 500
        
        videos = parse_video_json_output(result.stdout)
        
        if not videos:
            return jsonify({'error': 'No se encontraron videos en la playlist'}), 404
        
        return jsonify({
            'videos': videos,
            'total': len(videos),
            # El nombre de la lista, para la lista vinculada al seguirla (plan 14)
            'title': leer_salida(result.stdout)['titulo'],
        })
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'La consulta tardó demasiado'}), 504
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        app.logger.exception("Playlist info error")
        return jsonify({'error': 'Error al obtener información de la playlist'}), 500


# ========================================
# Modo radio (plan 16, T1)
# ========================================
#
# Las candidatas parecidas a una canción, de su mezcla de YouTube. La lógica y
# la caché de 30 minutos están en radio.py; aquí, cómo se lanza yt-dlp y la ruta.

RADIO_LIMITE = "20 per minute"
RADIO_TIMEOUT = 60


def _leer_mezcla(url):
    """Los vídeos de una mezcla RD, con el mismo comando que el selector de listas."""
    try:
        resultado = subprocess.run(  # noqa: S603 — lista de argumentos, sin shell; la URL la construye radio.py
            build_playlist_cmd(url, 'RD'), capture_output=True, text=True,
            timeout=RADIO_TIMEOUT, encoding='utf-8', errors='replace',
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        raise radio_mod.MezclaNoDisponible(type(e).__name__) from e
    if resultado.returncode != 0:
        app.logger.warning(f"Radio: yt-dlp terminó con código {resultado.returncode}")
        if youtube_limita(resultado.stderr):
            raise pico_mod.YoutubeLimita()
        raise radio_mod.MezclaNoDisponible(f'código {resultado.returncode}')
    return parse_video_json_output(resultado.stdout)


radio = radio_mod.Radio(_leer_mezcla)


@app.route('/api/radio', methods=['GET'])
@limiter.limit(RADIO_LIMITE)
def radio_candidatas():
    """Canciones parecidas a `semilla` (un id de vídeo), en el orden de su mezcla."""
    try:
        return jsonify({'candidatas': radio.candidatas(request.args.get('semilla', ''))})
    except radio_mod.SemillaNoValida as e:
        return jsonify({'error': str(e)}), 400
    except radio_mod.MezclaNoDisponible:
        return jsonify({'error': 'No se pudo leer la mezcla de YouTube'}), 502
    except pico_mod.YoutubeLimita as e:
        return respuesta_de_pico(e)


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
    
    cancelar_descarga_suelta(download_id)

    app.logger.info(f"Download {download_id} cancelled successfully")
    return jsonify({'status': 'cancelled', 'message': 'Download cancelled'})


def cancelar_descarga_suelta(download_id):
    """Cancela una descarga: la de la ruta de arriba y las canciones de un lote (plan 20)."""
    # Avisar a los hilos en curso antes de desmontar nada
    if download_id in download_cancellation:
        download_cancellation[download_id].set()

    db.complete_download_event(download_id, status='cancelled')

    # forget_download mata el proceso y limpia los tres diccionarios y la
    # carpeta en un solo sitio (plan 03, T4). Antes estaba repartido y se
    # dejaba siempre alguna estructura sin limpiar.
    forget_download(download_id)


MAX_BUSQUEDA_LOTE = 200


def objetivo_de_lote(url):
    """
    Lo que yt-dlp puede recibir de un elemento de lote: una URL de vídeo de
    YouTube validada, o un texto convertido en búsqueda del primer resultado.
    None si no vale.

    Antes la URL del lote iba a yt-dlp sin validar: el servidor descargaba de
    cualquier dirección (SSRF) y un texto que empezase por «-» se leía como una
    opción de yt-dlp. Con «ytsearch1:» delante, un texto nunca es una opción.
    """
    if not isinstance(url, str):
        return None
    url = url.strip()
    if not url:
        return None
    if is_search_query(url):
        return f'ytsearch1:{url[:MAX_BUSQUEDA_LOTE]}'
    tipo, _ = validate_youtube_url(url)
    # Una lista entera no cabe en un elemento de lote
    return url if tipo in ('video', 'shorts', 'music') else None


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

    # Cada elemento, una URL de vídeo de YouTube o una búsqueda: nada más llega a yt-dlp
    if not isinstance(videos, list) or not all(isinstance(v, dict) for v in videos):
        return jsonify({'error': 'Lista de videos no válida'}), 400
    limpios = []
    for v in videos:
        objetivo = objetivo_de_lote(v.get('url'))
        if objetivo is None:
            return jsonify({'error': 'URL de YouTube no válida'}), 400
        limpios.append({**v, 'url': objetivo})
    videos = limpios

    try:
        audio_format = resolve_audio_format(data)
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400

    try:
        pico.reservar(len(videos))
    except (pico_mod.YoutubeLimita, pico_mod.ServidorOcupado) as e:
        return respuesta_de_pico(e)

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


def get_playlist_count(url, hasta=MAX_CANCIONES_LISTA):
    """Cuántas canciones se descargarán de la lista: como mucho `hasta`, y sin esperar más de un minuto."""
    try:
        cmd = [
            sys.executable, '-m', 'yt_dlp',
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            '--ignore-errors',
            # Sin tope, una Mix tarda 23 s en contarse y da cientos de canciones
            '--playlist-end', str(hasta),
            url
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',  # noqa: S603 - lista de argumentos, sin shell; entrada validada
                                timeout=TIMEOUT_RECUENTO)

        if result.returncode == 0:
            try:
                data = json.loads(result.stdout)
                if 'entries' in data:
                    return min(len(data['entries'] or []), hasta)
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

    tope = tope_de_lista(content_id)
    total_count = min(get_playlist_count(search_query, hasta=tope) or 0, tope)
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
            canal = video_meta.get('channel') or video_meta.get('uploader')
            download_progress[download_id].update({
                'title': video_meta.get('title', 'Video'),
                'thumbnail': f"https://i.ytimg.com/vi/{video_meta.get('id')}/mqdefault.jpg",
                # Para la biblioteca inteligente (plan 11): el canal, la duración
                # y, si YouTube los sabe, artista y canción
                **({'channel': canal} if canal else {}),
                **({'duration': video_meta['duration']} if isinstance(video_meta.get('duration'), (int, float)) else {}),
                **metadatos_musicales(video_meta),
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
                          single=True, batch_item=False, hasta=None):
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
            # El id de YouTube de lo descargado: en una búsqueda no se sabe
            # hasta que yt-dlp la resuelve, y la biblioteca lo necesita
            '--print', 'after_video:DOWNLOAD_LOG_ID:%(id)s',
        ]

    if single:
        cmd.append('--no-playlist')
    elif hasta:
        cmd += ['--playlist-end', str(hasta)]

    cmd.append(target)
    return cmd


def build_ytdlp_download_cmd(content_type, search_query, audio_format=DEFAULT_AUDIO_FORMAT):
    """Comando para la ruta de descarga simple o de playlist. Una lista, con su tope."""
    hasta = None
    if content_type == 'playlist':
        lista = re.search(r'list=([a-zA-Z0-9_-]+)', search_query)
        hasta = tope_de_lista(lista.group(1) if lista else '')
    return build_ytdlp_audio_cmd(
        search_query, audio_format, single=(content_type != 'playlist'), hasta=hasta
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


_RE_ID_YOUTUBE = re.compile(r'^[A-Za-z0-9_-]{11}$')


def anotar_video_id(download_id, video_id):
    """
    El id de YouTube del vídeo descargado, para que el cliente lo guarde en la
    biblioteca. Solo el primero y solo si tiene forma de id de YouTube: en una
    lista hay varios, y ahí no se usa.
    """
    if not _RE_ID_YOUTUBE.match(video_id or ''):
        return
    with download_lock:
        entrada = download_progress.get(download_id)
        if entrada is not None and not entrada.get('video_id'):
            entrada['video_id'] = video_id


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

        if line.startswith('DOWNLOAD_LOG_ID:'):
            anotar_video_id(download_id, line.removeprefix('DOWNLOAD_LOG_ID:').strip())
            continue

        if is_progress_line(line):
            update_download_progress(download_id, line)
            
    return output_lines


# Sonoridad (plan 12, T4): ebur128 da la misma medida integrada que loudnorm
# en una trigésima parte del tiempo (0,2 s frente a 5 s para 4 minutos),
# porque no sobremuestrea a 192 kHz para el pico real. El pico de muestra basta:
# la igualación del cliente solo atenúa, y el límite de pico solo cuenta al subir.
SONORIDAD_TIMEOUT = 30
_RE_EBUR128_I = re.compile(r'^\s*I:\s+(-?\d+(?:\.\d+)?)\s+LUFS', re.MULTILINE)
_RE_EBUR128_PICO = re.compile(r'^\s*Peak:\s+(-?\d+(?:\.\d+)?|-inf)\s+dBFS', re.MULTILINE)


def leer_ebur128(salida):
    """{lufs, pico} del resumen final de ebur128, o None si no está o es silencio."""
    resumen = salida.rsplit('Summary:', 1)
    if len(resumen) < 2:
        return None
    integrada = _RE_EBUR128_I.search(resumen[1])
    if not integrada:
        return None
    lufs = float(integrada.group(1))
    if lufs <= -70:  # la compuerta absoluta: todo silencio
        return None
    pico = _RE_EBUR128_PICO.search(resumen[1])
    medida = {'lufs': round(lufs, 1)}
    if pico and pico.group(1) != '-inf':
        medida['pico'] = round(float(pico.group(1)), 1)
    return medida


def medir_sonoridad(ruta):
    """
    Sonoridad integrada (EBU R128) de un fichero de audio, o None.

    Con prioridad baja y bajo el mismo semáforo que las conversiones a mp3,
    para no competir con las descargas. Fallar al medir nunca hace fallar la
    descarga: sin medida, el cliente la mide él mismo más tarde.
    """
    cmd = [FFMPEG_PATH, '-hide_banner', '-nostats', '-nostdin', '-i', ruta,
           '-map', '0:a:0', '-af', 'ebur128=peak=sample', '-f', 'null', '-']
    if os.name != 'nt' and shutil.which('nice'):
        cmd = ['nice', '-n', '10', *cmd]
    try:
        with transcode_slots:
            proc = subprocess.run(  # noqa: S603 - lista de argumentos, sin shell; ruta de safe_download_path
                cmd, capture_output=True, text=True, timeout=SONORIDAD_TIMEOUT,
                encoding='utf-8', errors='replace',
            )
    except (subprocess.SubprocessError, OSError) as e:
        app.logger.warning(f"No se pudo medir la sonoridad: {e}")
        return None
    if proc.returncode != 0:
        app.logger.warning(f"ffmpeg no pudo medir la sonoridad (código {proc.returncode})")
        return None
    return leer_ebur128(proc.stderr)


def sonoridad_de_carpeta(download_folder):
    """La medida del único fichero de audio de la carpeta, si hay exactamente uno."""
    try:
        ficheros = [f for f in os.listdir(download_folder) if f.lower().endswith(AUDIO_EXTENSIONS)]
    except OSError:
        return None
    if len(ficheros) != 1:
        return None
    return medir_sonoridad(os.path.join(download_folder, ficheros[0]))


def finalize_download_status(download_id, proc, download_folder, total_count, output_lines=()):
    """Set the final progress status after yt-dlp exits."""
    if is_download_cancelled(download_id):
        app.logger.info(f"Download {download_id} cancelled")
        return

    time.sleep(1)
    final_count = count_downloaded_files(download_folder)

    extra = {}
    if final_count > 0:
        final_status = 'complete'
        final_msg = f'¡{final_count} canciones descargadas!'
        final_code, final_params = 'complete_n', {'count': final_count}
        # Una canción suelta va a la biblioteca: se mide antes de avisar al
        # cliente, que recoge los datos en cuanto ve «complete» (unos 0,2 s)
        if final_count == 1:
            medida = sonoridad_de_carpeta(download_folder)
            if medida:
                extra['loudness'] = medida
    else:
        final_status = 'error'
        final_msg = 'No se pudo descargar ninguna canción'
        final_code, final_params = 'error_none', {}
        if proc.returncode != 0:
            final_msg += f" (Código {proc.returncode})"
        # YouTube limita al servidor (plan 21, T7): un mensaje que lo explique
        if youtube_limita(output_lines):
            final_msg = 'YouTube está limitando las descargas. Prueba en un rato.'
            final_code = 'error_youtube_limit'

    update_progress(
        download_id,
        status=final_status,
        current=final_count,
        total=total_count if total_count > 0 else final_count,
        message=final_msg,
        code=final_code,
        params=final_params,
        **extra,
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

        finalize_download_status(download_id, proc, download_folder, total_count, output_lines)

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

    try:
        pico.reservar(total_count)
    except (pico_mod.YoutubeLimita, pico_mod.ServidorOcupado) as e:
        return respuesta_de_pico(e)

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


# ========================================
# Lotes (plan 20): muchas canciones, una sola petición
# ========================================

LOTES_LIMITE = "3 per minute;20 per hour"
MAX_NOMBRE_LOTE = 120


def _cancion_de_lote(v):
    """Una canción del lote validada (url, título, canal…), o None si no vale."""
    if not isinstance(v, dict):
        return None
    objetivo = objetivo_de_lote(v.get('url'))
    if objetivo is None:
        return None
    if objetivo.startswith('ytsearch'):
        tipo, video_id = 'search', None
    else:
        tipo, video_id = validate_youtube_url(objetivo)
    duracion = v.get('duration')
    return {
        'objetivo': objetivo,
        'tipo': tipo,
        'video_id': video_id,
        # Lo que ya sabe el cliente, para enseñarlo mientras espera; YouTube lo corrige al empezar
        'titulo': _RE_CONTROL.sub('', str(v.get('title') or ''))[:300],
        'canal': _RE_CONTROL.sub('', str(v.get('channel') or ''))[:120],
        'duracion': int(duracion) if isinstance(duracion, (int, float)) and 0 <= duracion <= 86400 else 0,
    }


def _descargar_cancion_de_lote(download_id, cancion):
    """Una canción del lote: la misma descarga suelta de /api/start-download."""
    if download_id not in download_progress or is_download_cancelled(download_id):
        return
    update_progress(download_id, status='starting', message='Iniciando descarga...', code='starting')
    prefetch_video_metadata(cancion['objetivo'], download_id)
    run_download_task(download_id, cancion['tipo'], cancion['objetivo'], 1, cancion['formato'])


gestor_lotes = lotes_mod.Lotes(
    descargar=_descargar_cancion_de_lote,
    cancelar=cancelar_descarga_suelta,
    estado_de=lambda download_id: (download_progress.get(download_id) or {}).get('status'),
    executor=executor,
)


def _lote_id_valido(lote_id):
    return re.fullmatch(r'[a-f0-9]{32}', lote_id or '') is not None


@app.route('/api/lotes', methods=['POST'])
@limiter.limit(LOTES_LIMITE)
def crear_lote():
    """Descarga varias canciones: cada una es una descarga suelta, de 3 en 3."""
    data = request.get_json(silent=True) or {}
    canciones = data.get('canciones')
    if not isinstance(canciones, list) or not canciones:
        return jsonify({'error': 'No hay canciones que descargar'}), 400
    if len(canciones) > lotes_mod.MAX_POR_LOTE:
        return jsonify({'error': f'Máximo {lotes_mod.MAX_POR_LOTE} canciones por lote'}), 400
    validas = [_cancion_de_lote(v) for v in canciones]
    if any(c is None for c in validas):
        return jsonify({'error': 'URL de YouTube no válida'}), 400
    try:
        audio_format = resolve_audio_format(data)
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    nombre = _RE_CONTROL.sub('', str(data.get('nombre') or ''))[:MAX_NOMBRE_LOTE]

    clave = clave_de_limite()
    try:
        pico.comprobar(len(validas))
    except (pico_mod.YoutubeLimita, pico_mod.ServidorOcupado) as e:
        return respuesta_de_pico(e)
    try:
        gestor_lotes.reservar(clave, len(validas))
    except lotes_mod.CupoAgotado as e:
        return jsonify({
            'error': f'Has llegado al máximo de {lotes_mod.MAX_CANCIONES_POR_HORA} canciones por hora',
            'code': 'hour_limit',
            'quedan': e.quedan,
        }), 429
    try:
        pico.reservar(len(validas))
    except (pico_mod.YoutubeLimita, pico_mod.ServidorOcupado) as e:
        return respuesta_de_pico(e)

    usuario = get_current_user()
    for cancion in validas:
        download_id = uuid.uuid4().hex
        os.makedirs(os.path.join(TEMP_DIR, download_id), exist_ok=True)
        cancion.update(download_id=download_id, formato=audio_format)
        register_download(
            download_id, 1,
            status='queued', message='En cola', code='queued',
            video_id=cancion['video_id'], format=audio_format,
            title=cancion['titulo'],
            thumbnail=f"https://i.ytimg.com/vi/{cancion['video_id']}/mqdefault.jpg" if cancion['video_id'] else '',
            **({'channel': cancion['canal']} if cancion['canal'] else {}),
            **({'duration': cancion['duracion']} if cancion['duracion'] else {}),
        )
        db.log_download_started(
            download_id, video_id=cancion['video_id'] or '', title=cancion['titulo'],
            content_type=cancion['tipo'], total_items=1,
            user_id=usuario['id'] if usuario else None,
        )

    lote_id = gestor_lotes.crear(validas, nombre=nombre, clave=clave)
    app.logger.info(f"Lote {lote_id}: {len(validas)} canciones")
    return jsonify(gestor_lotes.resumen(lote_id))


@app.route('/api/lotes/<lote_id>', methods=['GET'])
@limiter.exempt
def ver_lote(lote_id):
    """Cómo va el lote. Se consulta a menudo, como el progreso: sin límite."""
    if not _lote_id_valido(lote_id):
        return jsonify({'error': 'Lote no válido'}), 400
    resumen = gestor_lotes.resumen(lote_id)
    if resumen is None:
        return jsonify({'error': 'El lote ya no existe'}), 404
    return jsonify(resumen)


@app.route('/api/lotes/<lote_id>', methods=['DELETE'])
@limiter.limit("10 per minute")
def cancelar_lote(lote_id):
    """Cancela el lote: lo que está en cola no empieza y lo que está en marcha se para."""
    if not _lote_id_valido(lote_id):
        return jsonify({'error': 'Lote no válido'}), 400
    if not gestor_lotes.cancelar(lote_id):
        return jsonify({'error': 'El lote ya no existe'}), 404
    return jsonify(gestor_lotes.resumen(lote_id))


@app.route('/api/lotes/<lote_id>/zip', methods=['GET'])
@limiter.limit("10 per minute")
def zip_de_lote(lote_id):
    """Lo terminado del lote en un ZIP: la opción «Descargar como ZIP»."""
    if not _lote_id_valido(lote_id):
        return jsonify({'error': 'Lote no válido'}), 400
    resumen = gestor_lotes.resumen(lote_id)
    if resumen is None:
        return jsonify({'error': 'El lote ya no existe'}), 404
    ficheros = []
    for cancion in resumen['canciones']:
        carpeta = safe_download_path(cancion['downloadId'])
        if cancion['estado'] != lotes_mod.HECHA or not carpeta or not os.path.isdir(carpeta):
            continue
        ficheros += [os.path.join(carpeta, f) for f in sorted(os.listdir(carpeta))
                     if f.lower().endswith(AUDIO_EXTENSIONS)]
    if not ficheros:
        return jsonify({'error': 'Aún no hay canciones terminadas'}), 404

    # En su propia carpeta, que el barrido de huérfanas se lleva en una hora
    carpeta_zip = safe_download_path(lote_id)
    os.makedirs(carpeta_zip, exist_ok=True)
    ruta_zip = os.path.join(carpeta_zip, 'lote.zip')
    usados = set()
    with zipfile.ZipFile(ruta_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for ruta in ficheros:
            nombre = os.path.basename(ruta)
            base, ext = os.path.splitext(nombre)
            n = 2
            while nombre in usados:  # dos canciones con el mismo título
                nombre = f'{base} ({n}){ext}'
                n += 1
            usados.add(nombre)
            zipf.write(ruta, nombre)
    nombre_zip = re.sub(r'[^\w\- ]', '', resumen['nombre'] or '').strip() or 'canciones'
    return send_file(ruta_zip, as_attachment=True, download_name=f'{nombre_zip[:60]}.zip',
                     mimetype='application/zip')


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


# ========================================
# Sincronización de la cuenta (plan 13)
# ========================================
#
# Todo lo que llega es dato externo: cada campo se valida con los mismos
# límites que usa el cliente (features/sync/limites.js). Cada consulta filtra
# por el usuario del token, nunca por uno que venga en el cuerpo.

SYNC_MAX_CAMBIOS = 500
SYNC_MAX_CANCIONES_LISTA = 1000
SYNC_LIMITE_PETICIONES = "30 per minute"
SYNC_TEXTOS = {'title': 300, 'channel': 120, 'artist': 120, 'track': 120, 'extra': 120}
SYNC_NOMBRE_LISTA = 40
SYNC_DESCRIPCION_LISTA = 200
SYNC_IDIOMAS = frozenset({'es', 'en', 'fr', 'de', 'pt', 'zh'})
SYNC_FUNDIDOS = frozenset({0, 2, 4, 6, 8, 12})
_RE_LISTA_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
_RE_DISPOSITIVO = re.compile(r'^[A-Za-z0-9-]{8,64}$')
_RE_CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def clave_de_limite():
    """El límite de la sincronización es por cuenta; sin sesión válida, por IP."""
    try:
        token = request.headers.get('Authorization', '').split(' ', 1)[1]
        return f"u:{jwt.decode(token, JWT_SECRET, algorithms=['HS256'])['user_id']}"
    except (IndexError, KeyError, jwt.InvalidTokenError):
        return get_remote_address()


def _texto(valor, maximo, campo):
    """Texto recortado a `maximo`, sin caracteres de control. None o ausente: ''."""
    if valor is None:
        return ''
    if not isinstance(valor, str):
        raise InvalidInputError(f'{campo} no es un texto')
    return _RE_CONTROL.sub(' ', valor).strip()[:maximo]


def _entero(valor, minimo, maximo, campo, defecto=None):
    if valor is None and defecto is not None:
        return defecto
    # bool es un int en Python: no vale como número
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or valor != valor \
            or valor in (float('inf'), float('-inf')) or not minimo <= valor <= maximo:
        raise InvalidInputError(f'{campo} fuera de rango')
    return int(valor)


def _fecha(valor, campo):
    """Una fecha ISO 8601, normalizada. Ausente: ahora."""
    if valor is None:
        return datetime.now(timezone.utc).isoformat()
    if not isinstance(valor, str) or len(valor) > 40:
        raise InvalidInputError(f'{campo} no es una fecha')
    try:
        fecha = datetime.fromisoformat(valor.replace('Z', '+00:00'))
    except ValueError:
        raise InvalidInputError(f'{campo} no es una fecha') from None
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=timezone.utc)
    return fecha.isoformat()


def _video_id(valor):
    if not isinstance(valor, str) or not _RE_ID_YOUTUBE.match(valor):
        raise InvalidInputError('videoId no válido')
    return valor


def _objeto(valor, campo):
    if not isinstance(valor, dict):
        raise InvalidInputError(f'{campo} no es un objeto')
    return valor


def validar_cancion_sync(d):
    d = _objeto(d, 'canción')
    limpia = {'video_id': _video_id(d.get('videoId'))}
    for campo, maximo in SYNC_TEXTOS.items():
        limpia[campo] = _texto(d.get(campo), maximo, campo)
    editado = d.get('editado', False)
    if not isinstance(editado, bool):
        raise InvalidInputError('editado no es verdadero o falso')
    limpia['editado'] = editado
    limpia['duration'] = _entero(d.get('duration'), 0, 86_400, 'duration', defecto=0)
    limpia['added_at'] = _fecha(d.get('addedAt'), 'addedAt')
    return limpia


def validar_lista_sync(d):
    d = _objeto(d, 'lista')
    lid = d.get('id')
    if not isinstance(lid, str) or not _RE_LISTA_ID.match(lid):
        raise InvalidInputError('id de lista no válido')
    nombre = _texto(d.get('name'), 1000, 'name')
    if not 1 <= len(nombre) <= SYNC_NOMBRE_LISTA:
        raise InvalidInputError('El nombre de la lista tiene que tener de 1 a 40 caracteres')
    canciones = d.get('songs', [])
    if not isinstance(canciones, list) or len(canciones) > SYNC_MAX_CANCIONES_LISTA:
        raise InvalidInputError('canciones de la lista no válidas')
    vistas = []
    for vid in canciones:
        vid = _video_id(vid)
        if vid not in vistas:
            vistas.append(vid)
    return {
        'id': lid, 'name': nombre,
        'description': _texto(d.get('description'), SYNC_DESCRIPCION_LISTA, 'description'),
        'songs': vistas, 'created_at': _fecha(d.get('createdAt'), 'createdAt'),
    }


def validar_ajustes_sync(d):
    """Solo lo que se conoce; lo demás se descarta."""
    d = _objeto(d, 'ajustes')
    limpios = {}
    if 'idioma' in d:
        if d['idioma'] not in SYNC_IDIOMAS:
            raise InvalidInputError('idioma no válido')
        limpios['idioma'] = d['idioma']
    if 'reproduccion' in d:
        r = _objeto(d['reproduccion'], 'reproduccion')
        rep = {}
        if 'fundido' in r:
            if isinstance(r['fundido'], bool) or r['fundido'] not in SYNC_FUNDIDOS:
                raise InvalidInputError('fundido no válido')
            rep['fundido'] = int(r['fundido'])
        for campo in ('igualar', 'visualizador'):
            if campo in r:
                if not isinstance(r[campo], bool):
                    raise InvalidInputError(f'{campo} no es verdadero o falso')
                rep[campo] = r[campo]
        limpios['reproduccion'] = rep
    return limpios


def validar_cambios_sync(cambios):
    if not isinstance(cambios, list) or len(cambios) > SYNC_MAX_CAMBIOS:
        raise InvalidInputError(f'Hasta {SYNC_MAX_CAMBIOS} cambios por petición')
    limpios = []
    for c in cambios:
        c = _objeto(c, 'cambio')
        tipo, accion = c.get('tipo'), c.get('accion')
        datos = c.get('datos')
        if tipo == 'cancion' and accion == 'poner':
            datos = validar_cancion_sync(datos)
        elif tipo == 'cancion' and accion == 'borrar':
            datos = {'video_id': _video_id(_objeto(datos, 'datos').get('videoId'))}
        elif tipo == 'lista' and accion == 'poner':
            datos = validar_lista_sync(datos)
        elif tipo == 'lista' and accion == 'borrar':
            lid = _objeto(datos, 'datos').get('id')
            if not isinstance(lid, str) or not _RE_LISTA_ID.match(lid):
                raise InvalidInputError('id de lista no válido')
            datos = {'id': lid}
        elif tipo == 'ajustes' and accion == 'poner':
            datos = validar_ajustes_sync(datos)
        else:
            raise InvalidInputError('tipo o acción no válidos')
        limpios.append({'tipo': tipo, 'accion': accion, 'datos': datos})
    return limpios


def validar_escuchas_sync(escuchas):
    if not isinstance(escuchas, list) or len(escuchas) > SYNC_MAX_CAMBIOS:
        raise InvalidInputError(f'Hasta {SYNC_MAX_CAMBIOS} escuchas por petición')
    manana_ms = int((time.time() + 86_400) * 1000)
    return [{
        'id': _entero(_objeto(e, 'escucha').get('id'), 0, 2 ** 53, 'id'),
        'video_id': _video_id(e.get('videoId')),
        'artist': _texto(e.get('artista'), 120, 'artista'),
        'track': _texto(e.get('cancion'), 120, 'cancion'),
        't': _entero(e.get('t'), 0, manana_ms, 't'),
        'seconds': _entero(e.get('s'), 0, 86_400, 's'),
    } for e in escuchas]


def _dispositivo(valor):
    if not isinstance(valor, str) or not _RE_DISPOSITIVO.match(valor):
        raise InvalidInputError('dispositivo no válido')
    return valor


def _cuerpo_json():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        raise InvalidInputError(NO_DATA_ERROR)
    return datos


@app.route('/api/account', methods=['DELETE'])
@limiter.limit("5 per hour", key_func=clave_de_limite)
@auth_required
def borrar_mi_cuenta():
    """
    «Borrar mi cuenta» (plan 21, T6): la cuenta y todo lo que el servidor
    guarda de ella, sin vuelta atrás. Lo que hay en el dispositivo (el audio,
    la biblioteca local) no se toca: es del usuario y lo borra él si quiere.
    """
    user_id = request.user['id']
    if not db.borrar_cuenta(user_id):
        return jsonify({'error': 'La cuenta no existe'}), 404
    app.logger.info("Cuenta borrada a petición de su dueño")
    return jsonify({'ok': True})


@app.route('/api/sync', methods=['GET'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def sync_leer():
    """Lo que ha cambiado en la cuenta desde ?desde=N (0 = todo)."""
    try:
        desde = int(request.args.get('desde', '0'))
    except ValueError:
        return jsonify({'error': 'desde no es un número'}), 400
    if desde < 0:
        return jsonify({'error': 'desde no es un número'}), 400
    return jsonify(db.cambios_desde(request.user['id'], desde))


@app.route('/api/sync', methods=['POST'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def sync_escribir():
    """Aplica los cambios de un dispositivo, todos o ninguno."""
    try:
        datos = _cuerpo_json()
        _dispositivo(datos.get('dispositivo'))
        cambios = validar_cambios_sync(datos.get('cambios'))
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    try:
        seq = db.aplicar_cambios(request.user['id'], cambios)
    except db.LimiteSuperado:
        return jsonify({'error': 'La cuenta llegaría al máximo de canciones o de listas'}), 413
    return jsonify({'seq': seq})


@app.route('/api/sync/escuchas', methods=['POST'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def sync_escuchas():
    """Guarda las escuchas de un dispositivo (para «Tu año en música», plan 17)."""
    try:
        datos = _cuerpo_json()
        dispositivo = _dispositivo(datos.get('dispositivo'))
        escuchas = validar_escuchas_sync(datos.get('escuchas'))
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    db.registrar_escuchas(request.user['id'], dispositivo, escuchas)
    return jsonify({'ok': True})


@app.route('/api/sync/eliminadas', methods=['GET'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def sync_eliminadas():
    """Canciones borradas en los últimos 30 días."""
    return jsonify({'canciones': db.eliminadas_recientes(request.user['id'])})


@app.route('/api/sync/restaurar', methods=['POST'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def sync_restaurar():
    """Devuelve canciones de la papelera a la biblioteca de la cuenta."""
    try:
        ids = _cuerpo_json().get('videoIds')
        if not isinstance(ids, list) or not 1 <= len(ids) <= SYNC_MAX_CAMBIOS:
            raise InvalidInputError('videoIds no válidos')
        ids = [_video_id(v) for v in ids]
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'seq': db.restaurar(request.user['id'], ids)})


# ========================================
# Listas de YouTube seguidas (plan 14)
# ========================================
#
# Seguir una lista es pedir que se vigile: la tarea `tareas.py comprobar_listas`
# (un temporizador de systemd, fuera de gunicorn) la lee cada 6 horas y apunta
# lo nuevo. Cada dispositivo pregunta aquí, recoge lo nuevo y lo confirma.

FOLLOWS_LIMITE = "10 per minute"


@app.route('/api/follows', methods=['GET'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def follows_leer():
    """Las listas seguidas, con lo nuevo que aún no ha recogido ningún dispositivo."""
    return jsonify({'listas': db.listas_seguidas(request.user['id'])})


@app.route('/api/follows', methods=['POST'])
@limiter.limit(FOLLOWS_LIMITE, key_func=clave_de_limite)
@auth_required
def follows_seguir():
    """Sigue una lista: la lee una vez y todo lo que ya tiene cuenta como visto."""
    try:
        datos = _cuerpo_json()
        lista_id = lista_de(datos.get('lista'))
        if not lista_id:
            raise InvalidInputError('Esa lista no se puede seguir (las mezclas automáticas y las privadas no)')
        local = datos.get('localPlaylistId')
        if not isinstance(local, str) or not _RE_LISTA_ID.match(local):
            raise InvalidInputError('localPlaylistId no válido')
        auto = datos.get('autoDownload', True)
        if not isinstance(auto, bool):
            raise InvalidInputError('autoDownload no es verdadero o falso')
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    try:
        leida = leer_lista(lista_id)
    except ListaNoDisponible:
        return jsonify({'error': 'No se pudo leer la lista: puede que sea privada o que ya no exista'}), 502
    if len(leida['canciones']) > MAX_CANCIONES_AL_SEGUIR:
        return jsonify({'error': f'Solo se pueden seguir listas de hasta {MAX_CANCIONES_AL_SEGUIR} canciones'}), 413
    try:
        db.seguir_lista(request.user['id'], lista_id, leida['titulo'], local, auto, leida['canciones'])
    except db.LimiteSuperado:
        return jsonify({'error': f'Se pueden seguir hasta {db.MAX_LISTAS_SEGUIDAS} listas'}), 409
    return jsonify({
        'listId': lista_id, 'title': leida['titulo'],
        'canciones': [{'videoId': c['video_id'], 'title': c['title'], 'channel': c['channel'], 'duration': c['duration']}
                      for c in leida['canciones']],
    })


@app.route('/api/follows/<list_id>', methods=['DELETE'])
@limiter.limit(FOLLOWS_LIMITE, key_func=clave_de_limite)
@auth_required
def follows_dejar(list_id):
    if not lista_de(list_id):
        return jsonify({'error': 'Lista no válida'}), 400
    if not db.dejar_de_seguir(request.user['id'], list_id):
        return jsonify({'error': 'No seguías esa lista'}), 404
    return jsonify({'ok': True})


@app.route('/api/follows/entregadas', methods=['POST'])
@limiter.limit(SYNC_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def follows_entregadas():
    """El dispositivo ya tiene estas canciones nuevas: no se vuelven a ofrecer."""
    try:
        datos = _cuerpo_json()
        lista_id = lista_de(datos.get('listId'))
        ids = datos.get('videoIds')
        if not lista_id or not isinstance(ids, list) or not 1 <= len(ids) <= SYNC_MAX_CAMBIOS:
            raise InvalidInputError('Datos no válidos')
        ids = [_video_id(v) for v in ids]
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    db.marcar_entregadas(request.user['id'], lista_id, ids)
    return jsonify({'ok': True})


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
# Tu año en música (plan 17)
# ========================================
#
# Devuelve las escuchas de la cuenta para que el cliente calcule el resumen del
# año con la misma función que usa sin sesión (plan 17, §2.2): una sola lógica.
# El formato es compacto porque un año son miles de filas y casi todas repiten
# el mismo artista y la misma canción.

RESUMEN_LIMITE_PETICIONES = "10 per minute"

# Años aceptados. El suelo es anterior al proyecto; el techo, el año siguiente al
# actual, para que Nochevieja en un huso adelantado no se quede sin resumen.
RESUMEN_ANIO_MINIMO = 2020


def _anio_de_consulta(valor):
    """
    El año de la cadena de consulta. Ausente: el actual en UTC.

    `_entero` exige un número (los JSON de las demás rutas ya lo traen), pero
    aquí el valor viene de la URL y siempre es texto: se convierte antes y se
    delega el rango en `_entero`, para que el error sea el mismo que en el resto.
    """
    if valor is None or valor == '':
        return datetime.now(timezone.utc).year
    if not isinstance(valor, str) or not valor.isdigit():
        raise InvalidInputError('anio fuera de rango')
    return _entero(int(valor), RESUMEN_ANIO_MINIMO, datetime.now(timezone.utc).year + 1, 'anio')


def comprimir_escuchas(filas):
    """
    Pasa las filas de db.escuchas_del_anio al formato compacto del plan 17, §2.2:

        {"catalogo": [[videoId, artista, cancion], …],
         "escuchas": [[indiceCatalogo, t, segundos], …]}

    Cada canción distinta aparece una vez en el catálogo y las escuchas la
    referencian por su posición. Con 11.000 escuchas de 300 canciones, ahorra
    más del 90 % de la respuesta.
    """
    catalogo = []
    indices = {}
    escuchas = []
    for video_id, artista, cancion, t, segundos in filas:
        clave = (video_id, artista, cancion)
        indice = indices.get(clave)
        if indice is None:
            indice = len(catalogo)
            indices[clave] = indice
            catalogo.append([video_id, artista, cancion])
        escuchas.append([indice, t, segundos])
    return {'catalogo': catalogo, 'escuchas': escuchas}


@app.route('/api/resumen/escuchas', methods=['GET'])
@limiter.limit(RESUMEN_LIMITE_PETICIONES, key_func=clave_de_limite)
@auth_required
def resumen_escuchas():
    """Escuchas de un año de la cuenta, de todos sus dispositivos."""
    try:
        anio = _anio_de_consulta(request.args.get('anio'))
    except InvalidInputError as e:
        return jsonify({'error': str(e)}), 400
    filas = db.escuchas_del_anio(request.user['id'], anio)
    # `anteriores` deja distinguir los descubrimientos en un dispositivo recién
    # instalado, donde el registro local no tiene nada de años pasados.
    return jsonify(comprimir_escuchas(filas) | {
        'anio': anio,
        'anteriores': db.artistas_anteriores(request.user['id'], anio),
    })


# ========================================
# Importar listas (plan 15)
# ========================================
#
# Buscar en YouTube las canciones de una lista traída de otro servicio. La
# lógica está en importar.py; aquí solo se conecta con yt-dlp, con el registro
# de progreso del plan 03 (así el progreso sale por el SSE que ya existe,
# /api/progress/stream/<id>) y con las rutas.

# La ruta más cara de la app: cada canción es una búsqueda (plan 15, §3). Por
# cuenta con sesión y por IP sin ella, como la sincronización: así una red móvil
# con muchos usuarios detrás de la misma IP no se reparte entre todos el cupo.
IMPORTAR_LIMITE = "2 per hour"
IMPORTAR_RESULTADO_LIMITE = "60 per minute"
IMPORTAR_TIMEOUT = 30          # segundos por búsqueda


def _ejecutar_busqueda_importar(consulta):
    """Una búsqueda de yt-dlp. Si falla, sin candidatas: la canción saldrá para revisar."""
    try:
        resultado = subprocess.run(  # noqa: S603 — lista de argumentos, nunca shell
            importar.comando_busqueda(sys.executable, consulta),
            capture_output=True, text=True, timeout=IMPORTAR_TIMEOUT,
            encoding='utf-8', errors='replace',
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        app.logger.warning(f"Importar: la búsqueda no respondió ({type(e).__name__})")
        return []
    if resultado.returncode != 0:
        app.logger.warning(f"Importar: yt-dlp terminó con código {resultado.returncode}")
        return []
    return importar.candidatas_de_salida(resultado.stdout, metadatos_musicales)


def _importar_empieza(id_, total):
    register_download(
        id_, total, status='downloading', tipo='importar',
        code='import_searching', params={'current': 0, 'total': total},
        message=f'Buscando 0 de {total}')


def _importar_avanza(id_, hechas, total):
    update_progress(
        id_, status='downloading', current=hechas,
        code='import_searching', params={'current': hechas, 'total': total},
        message=f'Buscando {hechas} de {total}')


def _importar_termina(id_, estado, total):
    ok = estado == 'hecho'
    update_progress(
        id_, status='complete' if ok else 'error', current=total,
        code='import_done' if ok else 'import_failed', params={'total': total},
        message='Búsqueda terminada' if ok else 'La búsqueda ha fallado')


gestor_importar = importar.GestorEncargos(
    _ejecutar_busqueda_importar,
    al_empezar=_importar_empieza, al_avanzar=_importar_avanza, al_terminar=_importar_termina)


@app.route('/api/import/match', methods=['POST'])
@limiter.limit(IMPORTAR_LIMITE, key_func=clave_de_limite)
def importar_buscar():
    """Encarga la búsqueda de una lista. Devuelve el id para seguir el progreso."""
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        return jsonify({'error': NO_DATA_ERROR}), 400
    try:
        canciones = importar.validar_canciones(datos.get('canciones'))
    except importar.DatosNoValidos as e:
        return jsonify({'error': str(e)}), 400
    try:
        id_, total = gestor_importar.crear(canciones)
    except importar.ServidorOcupado:
        return jsonify({'error': 'Hay muchas importaciones en marcha. Prueba en unos minutos.',
                        'code': 'import_busy'}), 503
    return jsonify({'id': id_, 'total': total})


@app.route('/api/import/match/<id_>', methods=['GET'])
@limiter.limit(IMPORTAR_RESULTADO_LIMITE, key_func=clave_de_limite)
def importar_resultado(id_):
    """El resultado del encargo (o lo que lleva, si aún busca). Caduca a la hora."""
    if not re.fullmatch(r'[a-f0-9]{32}', id_):
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400
    resultado = gestor_importar.resultado(id_)
    if resultado is None:
        return jsonify({'error': 'La búsqueda ha caducado', 'code': 'import_expired'}), 404
    return jsonify(resultado)


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
