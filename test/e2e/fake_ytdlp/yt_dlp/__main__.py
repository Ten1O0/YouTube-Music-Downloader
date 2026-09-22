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
import os
import struct
import sys

CATALOGO = [
    {"id": "aaaaaaaaaaa", "title": "Cancion de prueba 1", "channel": "Canal E2E", "duration": 180},
    {"id": "bbbbbbbbbbb", "title": "Cancion de prueba 2", "channel": "Canal E2E", "duration": 210},
    {"id": "ccccccccccc", "title": "Cancion de prueba 3", "channel": "Otro Canal", "duration": 150},
]


def wav_de_un_segundo():
    """WAV de 1 s en silencio. Es audio válido que un navegador reproduce."""
    tasa, muestras = 8000, 8000
    datos = b"\x00\x00" * muestras
    return (
        b"RIFF" + struct.pack("<I", 36 + len(datos)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, tasa, tasa * 2, 2, 16)
        + b"data" + struct.pack("<I", len(datos)) + datos
    )


def porId(objetivo):
    """Devuelve la entrada del catálogo cuyo id aparece en la URL pedida."""
    for v in CATALOGO:
        if v["id"] in objetivo:
            return v
    return CATALOGO[0]


def valor(argv, bandera, defecto=None):
    return argv[argv.index(bandera) + 1] if bandera in argv else defecto


def main():
    argv = sys.argv[1:]
    objetivo = argv[-1] if argv else ""

    # --- Consulta de metadatos (búsqueda, info de playlist, prefetch) ---
    if "--dump-json" in argv:
        if "playlist" in objetivo or "list=" in objetivo:
            elegidos = CATALOGO
        elif objetivo.startswith("ytsearch"):
            elegidos = CATALOGO
        else:
            elegidos = [porId(objetivo)]

        if "--playlist-count" in argv or "%(playlist_count)s" in " ".join(argv):
            print(len(elegidos))
            return 0

        for v in elegidos:
            print(json.dumps({**v, "uploader": v["channel"]}))
        return 0

    # --- Recuento de playlist ---
    if "%(playlist_count)s" in " ".join(argv):
        print(len(CATALOGO))
        return 0

    # --- Descarga ---
    es_playlist = "--no-playlist" not in argv
    elegidos = CATALOGO if es_playlist else [porId(objetivo)]
    extension = valor(argv, "--audio-format", "m4a")

    for v in elegidos:
        for pct in ("0.0%", "45.0%", "100%"):
            print(f"[download] {pct} of 1.00MiB at 1.00MiB/s ETA 00:00", flush=True)

        destino = os.path.join(os.getcwd(), f"{v['title']}.{extension}")
        with open(destino, "wb") as fh:
            fh.write(wav_de_un_segundo())

        if "--print" in argv:
            print(f"DOWNLOAD_LOG_TITLE:{v['title']}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
