"""
Preparados para un pico de visitas (plan 21, T7).

Cuando muchas personas descargan a la vez, YouTube puede tomar el servidor
por un robot y dejar de servirle durante un rato («Sign in to confirm you're
not a bot»). Entonces fallan las descargas de todos. Aquí, sin Flask:

- reconocer ese bloqueo en lo que escribe yt-dlp, para decírselo al usuario
  con un mensaje propio en vez de un error genérico;
- no insistir mientras dura: unos minutos sin lanzar descargas nuevas, porque
  cada intento lo alarga;
- y un tope de canciones por hora para todo el servidor, además del de cada
  cuenta o IP (lotes.py), para no llegar a provocarlo.
"""

import collections
import re
import threading
import time

# Decidido con el usuario (plan 21, §3): canciones por hora en todo el servidor
MAX_CANCIONES_POR_HORA_GLOBAL = 600
HORA = 3600
# Tras un bloqueo de YouTube, sin descargas nuevas durante este tiempo
ENFRIAMIENTO_SEGUNDOS = 10 * 60

# Lo que escribe yt-dlp cuando YouTube limita al servidor. «Sign in to confirm
# your age» no es esto (es un vídeo con restricción de edad): no se cuenta
_BLOQUEO = re.compile(
    r"confirm you(?:'|’)?re not a bot|not a bot|rate-limited by youtube|"
    r"captcha challenge|http error 429|too many requests",
    re.IGNORECASE,
)


def es_bloqueo(lineas):
    """¿Dice la salida de yt-dlp que YouTube está limitando al servidor?"""
    if isinstance(lineas, str):
        lineas = [lineas]
    return any(_BLOQUEO.search(linea or '') for linea in lineas or [])


class ServidorOcupado(Exception):
    """El servidor ha llegado a su tope de canciones por hora."""


class YoutubeLimita(Exception):
    """YouTube está limitando al servidor: mejor no insistir durante un rato."""


class Pico:
    """El tope global por hora y el enfriamiento tras un bloqueo, en memoria."""

    def __init__(self, maximo=MAX_CANCIONES_POR_HORA_GLOBAL, enfriamiento=ENFRIAMIENTO_SEGUNDOS, reloj=time.time):
        self._maximo = maximo
        self._enfriamiento = enfriamiento
        self._reloj = reloj
        self._uso = collections.deque()   # (instante, canciones)
        self._bloqueado_hasta = 0.0
        self._lock = threading.Lock()

    def _usadas(self, ahora):
        while self._uso and ahora - self._uso[0][0] > HORA:
            self._uso.popleft()
        return sum(n for _, n in self._uso)

    def usadas(self):
        with self._lock:
            return self._usadas(self._reloj())

    def comprobar(self, n):
        """Lanza YoutubeLimita o ServidorOcupado si ahora no caben n canciones más. No apunta nada."""
        with self._lock:
            ahora = self._reloj()
            if ahora < self._bloqueado_hasta:
                raise YoutubeLimita()
            if self._usadas(ahora) + n > self._maximo:
                raise ServidorOcupado()

    def reservar(self, n):
        """Comprueba y apunta n canciones a la hora en curso."""
        with self._lock:
            ahora = self._reloj()
            if ahora < self._bloqueado_hasta:
                raise YoutubeLimita()
            if self._usadas(ahora) + n > self._maximo:
                raise ServidorOcupado()
            self._uso.append((ahora, n))

    def bloqueo(self):
        """YouTube acaba de limitar al servidor: se para un rato."""
        with self._lock:
            self._bloqueado_hasta = max(self._bloqueado_hasta, self._reloj() + self._enfriamiento)

    def bloqueado(self):
        with self._lock:
            return self._reloj() < self._bloqueado_hasta

    def reiniciar(self):
        with self._lock:
            self._uso.clear()
            self._bloqueado_hasta = 0.0
