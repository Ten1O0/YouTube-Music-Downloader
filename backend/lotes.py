"""
Lotes de descargas (plan 20): muchas canciones con una sola petición.

Un lote no descarga nada por sí mismo: organiza descargas sueltas, las mismas
de /api/start-download, cada una con su download_id, su progreso, su fichero y
sus datos (artista, canción, volumen). Las lanza de 3 en 3, para que un lote
grande no deje sin sitio a las descargas de los demás, y si se cancela, lo que
está en cola ya no empieza.

Sin Flask: el servidor le da cómo descargar, cancelar y consultar una descarga
suelta. Así se prueba con descargas simuladas.
"""

import collections
import threading
import time
import uuid

A_LA_VEZ = 3
MAX_POR_LOTE = 100
# Sustituye al límite por canción de /api/start-download: sumando lotes, como
# mucho esto por hora y cuenta (o IP sin sesión)
MAX_CANCIONES_POR_HORA = 300
HORA = 3600
# Lo terminado aguanta un día en el servidor (COMPLETED_TTL_SECONDS): el lote, algo más
TTL_SEGUNDOS = 25 * HORA

# Estados de una canción del lote, como los ve el cliente
EN_COLA, DESCARGANDO, HECHA, FALLIDA, CANCELADA, CADUCADA = (
    'en_cola', 'descargando', 'hecha', 'fallida', 'cancelada', 'caducada')
TERMINADOS = frozenset({HECHA, FALLIDA, CANCELADA, CADUCADA})


class CupoAgotado(Exception):
    """Se pasaría de las canciones por hora permitidas."""

    def __init__(self, quedan):
        super().__init__(f'quedan {quedan} canciones esta hora')
        self.quedan = quedan


class Lotes:
    """
    Registro de lotes en memoria (como el progreso de las descargas: gunicorn
    usa un solo proceso).

    - descargar(download_id, cancion): descarga una canción; bloquea hasta
      terminar. Se ejecuta en `executor`.
    - cancelar(download_id): cancela una descarga suelta en marcha.
    - estado_de(download_id): el `status` de su progreso, o None si ya no existe.
    """

    def __init__(self, descargar, cancelar, estado_de, executor, *,
                 a_la_vez=A_LA_VEZ, reloj=time.time):
        self._descargar = descargar
        self._cancelar = cancelar
        self._estado_de = estado_de
        self._executor = executor
        self._a_la_vez = a_la_vez
        self._reloj = reloj
        self._lotes = {}
        self._uso = collections.defaultdict(collections.deque)  # clave -> (instante, canciones)
        self._lock = threading.Lock()

    # ─── Cupo por hora ───

    def _usadas(self, clave, ahora):
        cola = self._uso[clave]
        while cola and ahora - cola[0][0] > HORA:
            cola.popleft()
        return sum(n for _, n in cola)

    def reservar(self, clave, n):
        """Apunta n canciones a la cuenta de la hora. Lanza CupoAgotado si no caben."""
        with self._lock:
            ahora = self._reloj()
            usadas = self._usadas(clave, ahora)
            if usadas + n > MAX_CANCIONES_POR_HORA:
                raise CupoAgotado(max(0, MAX_CANCIONES_POR_HORA - usadas))
            self._uso[clave].append((ahora, n))

    # ─── Lotes ───

    def crear(self, canciones, *, nombre='', clave=None):
        """
        Registra el lote y empieza a descargarlo. `canciones`: dicts ya
        validados con al menos 'download_id'. Devuelve el id del lote.
        """
        lote_id = uuid.uuid4().hex
        lote = {
            'id': lote_id,
            'nombre': nombre,
            'clave': clave,
            'creado': self._reloj(),
            'cancelado': threading.Event(),
            'canciones': [{**c, 'i': i, 'empezada': False} for i, c in enumerate(canciones)],
            'hilo': None,
        }
        with self._lock:
            self._lotes[lote_id] = lote
        hilo = threading.Thread(target=self._coordinar, args=(lote,), daemon=True,
                                name=f'lote-{lote_id[:8]}')
        lote['hilo'] = hilo
        hilo.start()
        return lote_id

    def _coordinar(self, lote):
        """De a_la_vez en a_la_vez; lo que queda en cola al cancelar no empieza."""
        huecos = threading.Semaphore(self._a_la_vez)
        futuros = []
        for cancion in lote['canciones']:
            huecos.acquire()
            if lote['cancelado'].is_set():
                huecos.release()
                break
            cancion['empezada'] = True
            try:
                futuro = self._executor.submit(self._descargar, cancion['download_id'], cancion)
            except RuntimeError:
                # El executor se está cerrando (el servidor se para)
                huecos.release()
                break
            futuro.add_done_callback(lambda _f: huecos.release())
            futuros.append(futuro)
        for futuro in futuros:
            try:
                futuro.result()
            except Exception:  # noqa: BLE001, S110 - cada descarga ya apunta su propio error
                pass

    def _estado_cancion(self, lote, cancion):
        if not cancion['empezada']:
            return CANCELADA if lote['cancelado'].is_set() else EN_COLA
        estado = self._estado_de(cancion['download_id'])
        if estado == 'complete':
            return HECHA
        if estado == 'error':
            return FALLIDA
        if estado == 'cancelled' or (estado is None and lote['cancelado'].is_set()):
            return CANCELADA
        if estado is None:
            return CADUCADA
        return DESCARGANDO

    def resumen(self, lote_id):
        """Lo que ve el cliente, o None si el lote no existe."""
        with self._lock:
            lote = self._lotes.get(lote_id)
        if lote is None:
            return None
        canciones = [{
            'i': c['i'],
            'downloadId': c['download_id'],
            'videoId': c.get('video_id') or '',
            'titulo': c.get('titulo') or '',
            'estado': self._estado_cancion(lote, c),
        } for c in lote['canciones']]
        cuenta = collections.Counter(c['estado'] for c in canciones)
        return {
            'loteId': lote_id,
            'nombre': lote['nombre'],
            'total': len(canciones),
            'hechas': cuenta[HECHA],
            'fallidas': cuenta[FALLIDA] + cuenta[CADUCADA],
            'enCurso': cuenta[DESCARGANDO],
            'enCola': cuenta[EN_COLA],
            'cancelado': lote['cancelado'].is_set(),
            'terminado': all(c['estado'] in TERMINADOS for c in canciones),
            'canciones': canciones,
        }

    def cancelar(self, lote_id):
        """Cancela el lote: lo que está en cola no empieza y lo que está en marcha se cancela."""
        with self._lock:
            lote = self._lotes.get(lote_id)
        if lote is None:
            return False
        lote['cancelado'].set()
        # Las que están en marcha se paran; las de la cola se dan de baja (si
        # no, su registro «en cola» se quedaría para siempre)
        for cancion in lote['canciones']:
            if self._estado_de(cancion['download_id']) in ('queued', 'starting', 'downloading'):
                self._cancelar(cancion['download_id'])
        return True

    def canciones_de(self, lote_id):
        """Los download_id del lote con su estado (para el ZIP)."""
        r = self.resumen(lote_id)
        return [] if r is None else [(c['downloadId'], c['estado']) for c in r['canciones']]

    def barrer(self):
        """Olvida los lotes viejos. Devuelve cuántos."""
        ahora = self._reloj()
        with self._lock:
            viejos = [i for i, lote in self._lotes.items() if ahora - lote['creado'] > TTL_SEGUNDOS]
            for i in viejos:
                del self._lotes[i]
            for clave in list(self._uso):
                self._usadas(clave, ahora)
                if not self._uso[clave]:
                    del self._uso[clave]
        return len(viejos)
