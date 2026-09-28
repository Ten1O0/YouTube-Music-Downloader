"""
Leer listas de YouTube (plan 14): qué canciones tiene una lista.

Lo usan el servidor, al seguir una lista, y la tarea que las comprueba cada
pocas horas (tareas.py). No importa Flask ni server.py: la tarea corre fuera
de gunicorn, y arrancar el servidor vaciaría la carpeta de descargas en curso.
"""

import json
import os
import re
import shutil
import subprocess
import sys

# Solo listas reales: las mezclas (RD…) cambian en cada visita y no se siguen
RE_LISTA_ID = re.compile(r'^[A-Za-z0-9_-]{10,64}$')
RE_LISTA_EN_URL = re.compile(r'[?&]list=([A-Za-z0-9_-]+)')
RE_VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')

MAX_CANCIONES_AL_SEGUIR = 500
MAX_CANCIONES_VIGILADAS = 1000
TIMEOUT = 60


class ListaNoDisponible(Exception):
    """YouTube no devuelve la lista: privada, borrada, o yt-dlp falló."""


def lista_de(texto):
    """El id de lista de una URL o de un id suelto, si se puede seguir. None si no."""
    if not isinstance(texto, str):
        return None
    texto = texto.strip()
    m = RE_LISTA_EN_URL.search(texto)
    lista_id = m.group(1) if m else texto
    if not RE_LISTA_ID.match(lista_id) or lista_id.startswith('RD'):
        return None
    return lista_id


def comando_lista(lista_id, hasta=MAX_CANCIONES_VIGILADAS + 1):
    """yt-dlp para leer la lista sin descargar nada, con prioridad baja."""
    cmd = [
        sys.executable, '-m', 'yt_dlp',
        f'https://www.youtube.com/playlist?list={lista_id}',
        '--dump-json', '--flat-playlist', '--no-warnings', '--no-download',
        '--playlist-end', str(hasta),
    ]
    if os.name != 'nt' and shutil.which('nice'):
        cmd = ['nice', '-n', '10', *cmd]
    return cmd


def leer_salida(salida):
    """Título de la lista y sus canciones, de la salida JSON (una línea por vídeo)."""
    titulo = ''
    canciones = []
    vistas = set()
    for linea in (salida or '').splitlines():
        try:
            video = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if not isinstance(video, dict):
            continue
        titulo = titulo or str(video.get('playlist_title') or video.get('playlist') or '')
        video_id = video.get('id')
        if not isinstance(video_id, str) or not RE_VIDEO_ID.match(video_id) or video_id in vistas:
            continue
        vistas.add(video_id)
        duracion = video.get('duration')
        canciones.append({
            'video_id': video_id,
            'title': str(video.get('title') or '')[:300],
            'channel': str(video.get('channel') or video.get('uploader') or '')[:120],
            'duration': int(duracion) if isinstance(duracion, (int, float)) and 0 <= duracion <= 86400 else 0,
        })
    return {'titulo': titulo[:200], 'canciones': canciones}


def leer_lista(lista_id, timeout=TIMEOUT):
    """Lee la lista de YouTube. Lanza ListaNoDisponible si no se puede."""
    if not RE_LISTA_ID.match(lista_id or '') or lista_id.startswith('RD'):
        raise ListaNoDisponible('lista no válida')
    try:
        proc = subprocess.run(  # noqa: S603 - lista de argumentos, sin shell; id validado
            comando_lista(lista_id), capture_output=True, text=True, timeout=timeout,
            encoding='utf-8', errors='replace',
        )
    except (subprocess.SubprocessError, OSError) as e:
        raise ListaNoDisponible(str(e)) from None
    resultado = leer_salida(proc.stdout)
    if proc.returncode != 0 and not resultado['canciones']:
        raise ListaNoDisponible(f'yt-dlp salió con {proc.returncode}')
    return resultado
