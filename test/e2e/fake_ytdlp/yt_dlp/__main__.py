"""
yt_dlp simulado para los recorridos end-to-end.

server.py invoca yt-dlp con `sys.executable -m yt_dlp`, así que basta con
anteponer este directorio a PYTHONPATH para que las descargas sean
instantáneas, deterministas y sin red.

Reproduce lo que el servidor necesita de la salida real:
  --dump-json     -> una línea JSON por vídeo
  --print         -> la marca DOWNLOAD_LOG_TITLE que el servidor busca
  descarga        -> líneas [download] de progreso y un fichero de audio real
"""

import json
import math
import os
import struct
import sys
import time
from itertools import zip_longest

CATALOGO = [
    {"id": "aaaaaaaaaaa", "title": "Cancion de prueba 1", "channel": "Canal E2E", "duration": 180},
    # Con artista y canción de YouTube, como los temas oficiales (plan 11)
    {"id": "bbbbbbbbbbb", "title": "Cancion de prueba 2", "channel": "Canal E2E", "duration": 210,
     "artist": "Artista Oficial", "track": "Tema Oficial"},
    # Con el ruido de siempre en el título y un canal VEVO (plan 11)
    {"id": "ccccccccccc", "title": "Grupo Tres - Cancion de prueba 3 (Official Video) [HD]", "channel": "GrupoTresVEVO", "duration": 150},
]

# Tonos de 6 s para el sonido (plan 12): dos iguales para las transiciones y
# uno fuerte para la igualación. Solo salen si se piden por su id.
TONOS = [
    {"id": "ddddddddddd", "title": "Tono uno", "channel": "Canal Tonos", "duration": 6, "amplitud": 0.1, "frecuencia": 440},
    {"id": "eeeeeeeeeee", "title": "Tono dos", "channel": "Canal Tonos", "duration": 6, "amplitud": 0.1, "frecuencia": 660},
    {"id": "fffffffffff", "title": "Tono fuerte", "channel": "Canal Tonos", "duration": 6, "amplitud": 0.9, "frecuencia": 550},
]

# Un vídeo cuyo título y canal llevan HTML (plan 10, T1). Solo sale al buscar
# «hostil», para no cambiar lo que ven los demás recorridos.
HOSTIL = {
    "id": "xssxssxssxs",
    "title": '<img src=x onerror="window.__xss=(window.__xss||0)+1">Titulo <b>hostil</b> & cia',
    "channel": '<svg onload="window.__xss=1">Canal',
    "duration": 120,
}

# Lotes (plan 20): canciones que tardan (para recargar a mitad de un lote) y
# una que falla siempre (para «Reintentar»). Solo salen si se piden por su id.
LENTAS = [{"id": f"lentolento{i}", "title": f"Lenta {i}", "channel": "Canal Lento", "duration": 60} for i in range(1, 7)]
SEGUNDOS_LENTA = 2
FALLA = {"id": "fallafalla1", "title": "Cancion que falla", "channel": "Canal Roto", "duration": 60}

# Una Mix (list=RD…): como en YouTube, larga y a veces con canciones repetidas.
# Solo se corta si se pide con --playlist-end, que es lo que se comprueba.
MIX = [*CATALOGO, CATALOGO[0], *TONOS] * 10

# Modo radio (plan 16): una semilla corta, para que la cola se acabe enseguida,
# y su mezcla de doce parecidas. Declaran una duración normal (la radio descarta
# lo de menos de un minuto), pero su audio dura `segundos`: 20 s, lo bastante
# para guardarlas o saltarlas antes de que acaben y sin alargar el recorrido.
# Empieza por la semilla, como en YouTube, y repite una con otro vídeo (la
# versión con letra) para el filtrado por título.
SEMILLA_RADIO = {"id": "semillaradi", "title": "Grupo Semilla - Empieza la radio", "channel": "Canal Radio",
                 "duration": 200, "segundos": 4, "amplitud": 0.1, "frecuencia": 330}
PARECIDAS = [{"id": f"parecida{i:03d}", "title": f"Grupo {i} - Parecida {i}", "channel": f"Canal {i}",
              "duration": 200 + i, "segundos": 20, "amplitud": 0.1, "frecuencia": 300 + 20 * i} for i in range(1, 13)]
MIX_RADIO = [SEMILLA_RADIO, PARECIDAS[0],
             {**PARECIDAS[0], "id": "parecidalyr", "title": "Grupo 1 - Parecida 1 (Lyrics)"}, *PARECIDAS[1:]]

# Una mezcla de nicho (plan 25), como la de KAZE: al principio casi todo es del
# mismo artista y los demás del estilo salen más abajo. 20 de «Grupo Nicho», una
# colaboración suya con «Grupo Amigo» y 8 artistas más, intercalados al final.
SEMILLA_NICHO = {"id": "semillanich", "title": "Grupo Nicho - Empieza el nicho", "channel": "Grupo Nicho",
                 "duration": 200, "segundos": 4, "amplitud": 0.1, "frecuencia": 350}
DEL_NICHO = [{"id": f"nicho{i:06d}", "title": f"Grupo Nicho - Tema {i}", "channel": "Grupo Nicho",
              "duration": 180 + i, "segundos": 20, "amplitud": 0.1, "frecuencia": 400 + 10 * i} for i in range(1, 21)]
COLABORACION = {"id": "nichojuntos", "title": "Grupo Nicho - Juntos (feat. Grupo Amigo)", "channel": "Grupo Nicho",
                "duration": 215, "segundos": 20, "amplitud": 0.1, "frecuencia": 640}
OTROS_DEL_ESTILO = [{"id": f"estilo{i:05d}", "title": f"Artista {i} - Canción del estilo {i}", "channel": f"Artista {i}",
                     "duration": 190 + i, "segundos": 20, "amplitud": 0.1, "frecuencia": 660 + 10 * i} for i in range(1, 9)]
MIX_NICHO = [SEMILLA_NICHO, *DEL_NICHO[:14], COLABORACION, *[x for par in zip_longest(OTROS_DEL_ESTILO, DEL_NICHO[14:]) for x in par if x]]

# Una mezcla larga (plan 25, «Cargar 25 más»): 130 canciones distintas, y en la
# posición 40 vuelve la tercera, como repiten las de YouTube
SEMILLA_LARGA = "larga000001"
DE_LA_LARGA = [{"id": f"larga{i:06d}", "title": f"Larga {i}", "channel": f"Canal Largo {i % 7}", "duration": 200}
               for i in range(1, 131)]
MIX_LARGA = [*DE_LA_LARGA[:39], DE_LA_LARGA[2], *DE_LA_LARGA[39:]]


def wav_de_un_segundo():
    """WAV de 1 s en silencio. Es audio válido que un navegador reproduce."""
    tasa, muestras = 8000, 8000
    datos = b"\x00\x00" * muestras
    return (
        b"RIFF" + struct.pack("<I", 36 + len(datos)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, tasa, tasa * 2, 2, 16)
        + b"data" + struct.pack("<I", len(datos)) + datos
    )


def wav_tono(segundos, amplitud, frecuencia):
    """WAV de un tono: audio que ffmpeg puede medir y que dura lo bastante para un fundido."""
    tasa = 8000
    muestras = [int(amplitud * 32767 * math.sin(2 * math.pi * frecuencia * i / tasa)) for i in range(tasa * segundos)]
    datos = struct.pack(f"<{len(muestras)}h", *muestras)
    return (
        b"RIFF" + struct.pack("<I", 36 + len(datos)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, tasa, tasa * 2, 2, 16)
        + b"data" + struct.pack("<I", len(datos)) + datos
    )


def porId(objetivo):
    """Devuelve la entrada del catálogo cuyo id aparece en la URL pedida."""
    for v in [*CATALOGO, *TONOS, HOSTIL, *LENTAS, FALLA, *MIX_RADIO, *MIX_NICHO]:
        if v["id"] in objetivo:
            return v
    return CATALOGO[0]


def canciones_extra():
    ruta = os.path.join(os.environ.get("YTDL_DATA_DIR", ""), "lista_extra.json")
    try:
        with open(ruta, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def valor(argv, bandera, defecto=None):
    return argv[argv.index(bandera) + 1] if bandera in argv else defecto


def main():
    argv = sys.argv[1:]
    objetivo = argv[-1] if argv else ""
    # La URL de una lista puede ir antes de las opciones (build_playlist_cmd la pone primero)
    es_lista = any(a.startswith("http") and ("/playlist" in a or "list=" in a) for a in argv) \
        or "playlist" in objetivo or "list=" in objetivo
    es_mix = any("list=RD" in a for a in argv)
    es_radio = any(f"list=RD{SEMILLA_RADIO['id']}" in a for a in argv)
    es_nicho = any(f"list=RD{SEMILLA_NICHO['id']}" in a for a in argv)
    es_larga = any(f"list=RD{SEMILLA_LARGA}" in a for a in argv)
    hasta = int(valor(argv, "--playlist-end", "0")) or None

    def la_lista():
        # Una lista que «crece» (plan 14): lo apuntado en lista_extra.json,
        # en el directorio de datos de los recorridos, se suma a la lista
        entradas = (MIX_LARGA if es_larga else MIX_NICHO if es_nicho else MIX_RADIO if es_radio else MIX) if es_mix else CATALOGO + canciones_extra()
        return entradas[:hasta] if hasta else entradas

    titulo_lista = "Mix - Cancion de prueba 1" if es_mix else "Lista E2E"

    # --- Recuento de una lista (get_playlist_count) ---
    if "--dump-single-json" in argv:
        entradas = la_lista() if es_lista else [porId(objetivo)]
        print(json.dumps({"title": titulo_lista, "entries": [{"id": v["id"]} for v in entradas]}))
        return 0

    # --- Consulta de metadatos (búsqueda, info de playlist, prefetch) ---
    if "--dump-json" in argv:
        if es_lista:
            elegidos = la_lista()
        elif any(a.startswith("ytsearch") and "hostil" in a for a in argv):
            elegidos = [HOSTIL]
        elif any(a.startswith("ytsearch") for a in argv):
            # El servidor pone «ytsearch20:…» primero y las opciones después:
            # la búsqueda no es necesariamente el último argumento
            elegidos = CATALOGO
        else:
            elegidos = [porId(objetivo)]

        if "--playlist-count" in argv or "%(playlist_count)s" in " ".join(argv):
            print(len(elegidos))
            return 0

        for v in elegidos:
            publico = {k: x for k, x in v.items() if k not in ("amplitud", "frecuencia", "segundos")}
            extra = {"playlist_title": titulo_lista} if es_lista else {}
            print(json.dumps({**publico, "uploader": v["channel"], **extra}))
        return 0

    # --- Recuento de playlist ---
    if "%(playlist_count)s" in " ".join(argv):
        print(len(CATALOGO))
        return 0

    # --- Descarga ---
    es_playlist = "--no-playlist" not in argv
    elegidos = (la_lista() if es_mix else CATALOGO) if es_playlist else [porId(objetivo)]
    extension = valor(argv, "--audio-format", "m4a")

    if elegidos == [FALLA]:
        print("ERROR: [youtube] fallafalla1: Video unavailable", flush=True)
        return 1

    for v in elegidos:
        if v in LENTAS:
            time.sleep(SEGUNDOS_LENTA)
        for pct in ("0.0%", "45.0%", "100%"):
            print(f"[download] {pct} of 1.00MiB at 1.00MiB/s ETA 00:00", flush=True)

        # Como el yt-dlp real: una «/» del título no puede ir en el nombre del fichero
        nombre = v['title'].replace('/', '\u29f8')
        destino = os.path.join(os.getcwd(), f"{nombre}.{extension}")
        with open(destino, "wb") as fh:
            fh.write(wav_tono(v.get("segundos", v["duration"]), v["amplitud"], v["frecuencia"]) if "amplitud" in v else wav_de_un_segundo())

        if "--print" in argv:
            print(f"DOWNLOAD_LOG_TITLE:{v['title']}", flush=True)
            print(f"DOWNLOAD_LOG_ID:{v['id']}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
