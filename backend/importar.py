"""
Importar listas de otros servicios: la búsqueda en YouTube (plan 15, T2).

Aquí está la lógica sin Flask, para poder probarla sin servidor:

- validar lo que llega del cliente (§3 del plan: es dato externo),
- construir las consultas a yt-dlp,
- buscar las candidatas de una canción (primero por ISRC y después por nombre),
- y llevar los encargos: cada importación es un encargo con id que avanza en
  segundo plano, como las descargas, y cuyo resultado se guarda una hora.

Lo que toca el proceso de yt-dlp y el registro de progreso lo pone server.py al
crear el gestor (`ejecutar`, `al_empezar`, `al_avanzar`, `al_terminar`): así
este módulo no depende de cómo se lanzan los procesos ni de Flask.
"""

import concurrent.futures
import json
import re
import threading
import time
import uuid

# ========================================
# Límites (plan 15, §3)
# ========================================

MAX_CANCIONES = 500          # por importación: cada una es una búsqueda
MAX_CAMPO = 200              # título, artista y álbum
BUSQUEDAS_POR_ENCARGO = 3    # en paralelo dentro de un encargo
ENCARGOS_A_LA_VEZ = 2        # en todo el servidor
ENCARGOS_EN_COLA = 4         # esperando turno; más allá se rechaza
RESULTADO_TTL = 3600         # el resultado se borra a la hora
MAX_RESULTADOS = 20          # encargos guardados como mucho, por memoria

CANDIDATAS_NOMBRE = 5        # ytsearch5
CANDIDATAS_ISRC = 3          # ytsearch3


class DatosNoValidos(ValueError):
    """Lo que ha mandado el cliente no vale. El mensaje es para el usuario."""


class ServidorOcupado(RuntimeError):
    """Hay demasiados encargos en marcha o en cola."""


# ========================================
# Validación
# ========================================

_CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\ufeff]')
_RE_ISRC = re.compile(r'^[A-Z]{2}[A-Z0-9]{3}\d{7}$')


def limpiar_texto(valor, maximo=MAX_CAMPO):
    """Texto sin caracteres de control, espacios unidos y recortado. Lo que no es texto, ''."""
    if not isinstance(valor, str):
        return ''
    return ' '.join(_CONTROL.sub(' ', valor).split())[:maximo].strip()


def limpiar_isrc(valor):
    """ISRC en mayúsculas y sin guiones, o None si no tiene el formato."""
    if not isinstance(valor, str):
        return None
    isrc = valor.replace('-', '').replace(' ', '').upper()
    return isrc if _RE_ISRC.match(isrc) else None


def limpiar_duracion(valor):
    """Milisegundos enteros positivos (hasta 3 h), o None."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    if valor != valor or not 0 < valor <= 3 * 3600 * 1000:   # NaN o fuera de rango
        return None
    return int(valor)


def validar_canciones(canciones):
    """
    Lo que manda el cliente, limpio. Al servidor solo llegan título, artista,
    duración e ISRC (§3: el fichero no sale del dispositivo).

    Lanza DatosNoValidos si no hay nada que buscar o si se pasa del tope.
    """
    if not isinstance(canciones, list) or not canciones:
        raise DatosNoValidos('No hay canciones que buscar')
    if len(canciones) > MAX_CANCIONES:
        raise DatosNoValidos(f'Como mucho {MAX_CANCIONES} canciones por importación')
    limpias = []
    for c in canciones:
        if not isinstance(c, dict):
            continue
        titulo = limpiar_texto(c.get('titulo'))
        if not titulo:
            continue
        limpias.append({
            'titulo': titulo,
            'artista': limpiar_texto(c.get('artista')),
            'duracionMs': limpiar_duracion(c.get('duracionMs')),
            'isrc': limpiar_isrc(c.get('isrc')),
        })
    if not limpias:
        raise DatosNoValidos('Ninguna canción tiene título')
    return limpias


# ========================================
# Consultas a yt-dlp
# ========================================

def consulta_nombre(cancion):
    """
    `ytsearch5:<artista> - <título>`. El prefijo va siempre delante, así que la
    consulta nunca empieza por «--» aunque el título sí: no puede convertirse en
    una opción de yt-dlp (§3).
    """
    texto = f"{cancion['artista']} - {cancion['titulo']}" if cancion.get('artista') else cancion['titulo']
    return f'ytsearch{CANDIDATAS_NOMBRE}:{texto}'


def consulta_isrc(isrc):
    """`ytsearch3:"<ISRC>"`: YouTube Music indexa el ISRC de los temas oficiales."""
    return f'ytsearch{CANDIDATAS_ISRC}:"{isrc}"'


def comando_busqueda(ejecutable, consulta):
    """
    La orden como lista de argumentos, nunca por shell. El «--» cierra las
    opciones: aunque el prefijo ya lo impide, así ni siquiera una consulta mal
    construida podría leerse como opción.
    """
    return [
        ejecutable, '-m', 'yt_dlp',
        '--dump-json', '--flat-playlist', '--no-warnings', '--no-download',
        '--', consulta,
    ]


def candidatas_de_salida(salida, metadatos=lambda video: {}):
    """
    La salida de `--dump-json --flat-playlist` (una línea JSON por vídeo) como
    candidatas. Además de lo que ya da la búsqueda normal, `verificado` si
    yt-dlp lo indica, que cuenta en la puntuación (plan 15, §2.3).
    """
    candidatas = []
    vistos = set()
    for linea in (salida or '').splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            video = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if not isinstance(video, dict):
            continue
        vid = video.get('id')
        if not isinstance(vid, str) or not re.fullmatch(r'[\w-]{11}', vid) or vid in vistos:
            continue
        vistos.add(vid)
        duracion = video.get('duration')
        candidatas.append({
            'id': vid,
            'title': limpiar_texto(video.get('title')) or 'Sin título',
            'channel': limpiar_texto(video.get('channel') or video.get('uploader')),
            'duration': int(duracion) if isinstance(duracion, (int, float)) and duracion > 0 else 0,
            'thumbnail': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
            'verificado': video.get('channel_is_verified') is True,
            **metadatos(video),
        })
    return candidatas


def buscar_candidatas(cancion, ejecutar):
    """
    Las candidatas de una canción: primero por ISRC, si lo hay, y después por
    nombre. Las del ISRC van marcadas (`porIsrc`) y, si un vídeo sale en las dos
    búsquedas, se queda una vez con la marca.

    `ejecutar(consulta)` devuelve la lista de candidatas de esa consulta, o []
    si falla: una búsqueda que falla no debe tirar la importación entera.
    """
    resultado = []
    por_id = {}
    if cancion.get('isrc'):
        for c in ejecutar(consulta_isrc(cancion['isrc'])):
            c = {**c, 'porIsrc': True}
            por_id[c['id']] = c
            resultado.append(c)
    for c in ejecutar(consulta_nombre(cancion)):
        if c['id'] in por_id:
            continue
        c = {**c, 'porIsrc': False}
        por_id[c['id']] = c
        resultado.append(c)
    return resultado


# ========================================
# Encargos
# ========================================

class GestorEncargos:
    """
    Los encargos de búsqueda: como mucho ENCARGOS_A_LA_VEZ en marcha, unos pocos
    en cola, y dentro de cada uno BUSQUEDAS_POR_ENCARGO en paralelo.

    El resultado de cada encargo se guarda RESULTADO_TTL segundos y después se
    olvida. No hace falta un barrido aparte: se limpia al crear uno nuevo y al
    pedir uno.
    """

    def __init__(self, ejecutar, al_empezar=None, al_avanzar=None, al_terminar=None, reloj=time.time):
        self._ejecutar = ejecutar
        self._al_empezar = al_empezar or (lambda id_, total: None)
        self._al_avanzar = al_avanzar or (lambda id_, hechas, total: None)
        self._al_terminar = al_terminar or (lambda id_, estado, total: None)
        self._reloj = reloj
        self._lock = threading.Lock()
        self._resultados = {}      # id -> {'creado', 'estado', 'canciones', 'hechas', 'total'}
        self._pendientes = 0       # en marcha + en cola
        self._coordinadores = concurrent.futures.ThreadPoolExecutor(
            max_workers=ENCARGOS_A_LA_VEZ, thread_name_prefix='importar')

    def _purgar(self):
        """Olvida lo caducado y, si aun así sobran, lo más antiguo ya terminado."""
        ahora = self._reloj()
        for id_ in [i for i, r in self._resultados.items() if ahora - r['creado'] > RESULTADO_TTL]:
            del self._resultados[id_]
        terminados = sorted(
            (i for i, r in self._resultados.items() if r['estado'] != 'buscando'),
            key=lambda i: self._resultados[i]['creado'])
        while len(self._resultados) > MAX_RESULTADOS and terminados:
            del self._resultados[terminados.pop(0)]

    def crear(self, canciones):
        """Encarga la búsqueda. Devuelve (id, total). Lanza ServidorOcupado si no cabe."""
        with self._lock:
            self._purgar()
            if self._pendientes >= ENCARGOS_A_LA_VEZ + ENCARGOS_EN_COLA:
                raise ServidorOcupado('Hay demasiadas importaciones en marcha')
            self._pendientes += 1
            id_ = uuid.uuid4().hex     # el mismo formato que las descargas: vale para el SSE
            self._resultados[id_] = {
                'creado': self._reloj(), 'estado': 'buscando',
                'canciones': [None] * len(canciones), 'hechas': 0, 'total': len(canciones),
            }
        self._al_empezar(id_, len(canciones))
        self._coordinadores.submit(self._trabajar, id_, canciones)
        return id_, len(canciones)

    def _trabajar(self, id_, canciones):
        total = len(canciones)
        estado = 'hecho'
        try:
            with concurrent.futures.ThreadPoolExecutor(
                    max_workers=BUSQUEDAS_POR_ENCARGO, thread_name_prefix='importar-busqueda') as busquedas:
                futuros = {busquedas.submit(buscar_candidatas, c, self._ejecutar): i
                           for i, c in enumerate(canciones)}
                for futuro in concurrent.futures.as_completed(futuros):
                    i = futuros[futuro]
                    try:
                        candidatas = futuro.result()
                    except Exception:  # noqa: BLE001 — frontera de hilo: una canción no tumba el encargo
                        candidatas = []
                    with self._lock:
                        r = self._resultados.get(id_)
                        if r is None:
                            return   # caducó mientras tanto
                        r['canciones'][i] = {'origen': canciones[i], 'candidatas': candidatas}
                        r['hechas'] += 1
                        hechas = r['hechas']
                    self._al_avanzar(id_, hechas, total)
        except Exception:  # noqa: BLE001 — frontera de hilo: el encargo acaba en error, no en silencio
            estado = 'error'
        finally:
            with self._lock:
                self._pendientes -= 1
                if id_ in self._resultados:
                    self._resultados[id_]['estado'] = estado
            self._al_terminar(id_, estado, total)

    def resultado(self, id_):
        """El encargo tal como va, o None si no existe o ya caducó."""
        with self._lock:
            self._purgar()
            r = self._resultados.get(id_)
            if r is None:
                return None
            return {
                'estado': r['estado'],
                'hechas': r['hechas'],
                'total': r['total'],
                # Mientras busca, solo las que ya están
                'canciones': [c for c in r['canciones'] if c is not None],
            }

    def cerrar(self):
        """Para los hilos (tests)."""
        self._coordinadores.shutdown(wait=True)
