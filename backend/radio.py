"""
Modo radio: las candidatas parecidas a una canción (plan 16, T1).

Las saca de la mezcla que YouTube genera para cada vídeo
(`watch?v=<id>&list=RD<id>`): no hace falta ningún servicio de
recomendaciones. Aquí está la lógica sin Flask, para poder probarla sin
servidor:

- validar la semilla (lo único que llega del cliente) y construir la URL de la
  mezcla: nada del cliente llega tal cual a yt-dlp (§3 del plan);
- quedarse con lo que la radio necesita de cada vídeo, sin la propia semilla;
- y guardar cada mezcla 30 minutos, porque cada una es una llamada a yt-dlp.

Cómo se lanza yt-dlp lo pone server.py (`ejecutar`), como en importar.py.
"""

import re
import threading
import time

RE_VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')

CACHE_TTL = 30 * 60        # segundos que vale una mezcla
CACHE_MAX_SEMILLAS = 200   # mezclas guardadas como mucho, por memoria
MAX_CAMPO = 200            # título y canal


class SemillaNoValida(ValueError):
    """La semilla no es un id de vídeo de YouTube."""


class MezclaNoDisponible(RuntimeError):
    """yt-dlp no ha podido leer la mezcla."""


def validar_semilla(valor):
    """El id de vídeo tal cual si vale; si no, SemillaNoValida."""
    if not isinstance(valor, str) or not RE_VIDEO_ID.match(valor):
        raise SemillaNoValida('La semilla no es un id de vídeo válido')
    return valor


def url_mezcla(semilla):
    """La mezcla de YouTube de un vídeo. La construye el servidor, nunca el cliente."""
    semilla = validar_semilla(semilla)
    return f'https://www.youtube.com/watch?v={semilla}&list=RD{semilla}'


def _texto(valor):
    return valor.strip()[:MAX_CAMPO] if isinstance(valor, str) else ''


def _duracion(valor):
    """Segundos, o None si no se sabe (yt-dlp da 0 o nada en algunas entradas)."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or valor <= 0:
        return None
    return valor


def candidatas(videos, semilla):
    """
    Lo que la radio necesita de cada vídeo de la mezcla, en su orden y sin la
    propia semilla (la mezcla empieza por ella). Sin repetidos ni ids raros.
    """
    vistos = {semilla}
    salida = []
    for video in videos or []:
        id_ = video.get('id') if isinstance(video, dict) else None
        if not isinstance(id_, str) or not RE_VIDEO_ID.match(id_) or id_ in vistos:
            continue
        vistos.add(id_)
        salida.append({
            'id': id_,
            'title': _texto(video.get('title')),
            'channel': _texto(video.get('channel')),
            'duration': _duracion(video.get('duration')),
            'thumbnail': f'https://i.ytimg.com/vi/{id_}/mqdefault.jpg',
        })
    return salida


class Radio:
    """
    Las candidatas de cada semilla, con una caché en memoria: 30 minutos por
    mezcla y 200 mezclas como mucho (al pasar, sale la que caduca antes).

    `ejecutar(url)` devuelve los vídeos de la mezcla (lo que da
    parse_video_json_output) o lanza MezclaNoDisponible.
    """

    def __init__(self, ejecutar, ttl=CACHE_TTL, maximo=CACHE_MAX_SEMILLAS, reloj=time.monotonic):
        self._ejecutar = ejecutar
        self._ttl = ttl
        self._maximo = maximo
        self._reloj = reloj
        self._cache = {}   # semilla -> (caduca, candidatas)
        self._lock = threading.Lock()

    def candidatas(self, semilla):
        semilla = validar_semilla(semilla)
        with self._lock:
            guardada = self._cache.get(semilla)
            if guardada and guardada[0] > self._reloj():
                return list(guardada[1])

        # Fuera del cerrojo: yt-dlp tarda segundos y no debe parar a las demás
        lista = candidatas(self._ejecutar(url_mezcla(semilla)), semilla)
        # Una mezcla vacía no se guarda: puede ser un fallo pasajero de YouTube
        if lista:
            with self._lock:
                self._guardar(semilla, lista)
        return list(lista)

    def _guardar(self, semilla, lista):
        ahora = self._reloj()
        for clave in [c for c, (caduca, _) in self._cache.items() if caduca <= ahora]:
            del self._cache[clave]
        self._cache.pop(semilla, None)
        while len(self._cache) >= self._maximo:
            del self._cache[min(self._cache, key=lambda c: self._cache[c][0])]
        self._cache[semilla] = (ahora + self._ttl, lista)

    def __len__(self):
        with self._lock:
            return len(self._cache)

    def vaciar(self):
        with self._lock:
            self._cache.clear()
