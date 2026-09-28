#!/usr/bin/env bash
# ============================================================
#  Comprueba las listas de YouTube que siguen los usuarios (plan 14).
#
#  Lo lanza cada hora el temporizador comprobar-listas.timer (ver
#  instalar-comprobar-listas.sh). Cada lista se comprueba como mucho cada 6
#  horas, de una en una. Con un candado: si una ejecución tarda más de una
#  hora, la siguiente no se solapa, simplemente no hace nada.
#
#  No toca el servicio: corre aparte, con la misma base de datos.
# ============================================================
set -uo pipefail

RAIZ="${RAIZ:-/var/www/vhosts/dannarita.es/music.dannarita.es}"
export YTDL_DATA_DIR="${YTDL_DATA_DIR:-/var/lib/youtube-downloader}"
export PATH="$RAIZ/.venv/bin:/usr/bin:/bin"

exec 9>/run/comprobar-listas.lock
if ! flock -n 9; then
    echo "[comprobar-listas] otra comprobación sigue en marcha: nada que hacer"
    exit 0
fi

cd "$RAIZ/backend"
exec timeout 3000 nice -n 10 "$RAIZ/.venv/bin/python" tareas.py comprobar_listas
