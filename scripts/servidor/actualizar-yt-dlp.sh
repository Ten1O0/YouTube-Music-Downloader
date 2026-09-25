#!/usr/bin/env bash
# ============================================================
#  Actualiza yt-dlp en el servidor y comprueba que sigue funcionando.
#
#  YouTube cambia a menudo y una versión de yt-dlp con unas semanas deja de
#  extraer audio: las descargas fallarían sin avisar. Lo lanza cada día el
#  temporizador ytdlp-actualizar.timer (ver instalar-actualizacion-yt-dlp.sh).
#
#  - Actualiza "yt-dlp[default]", que trae el yt-dlp-ejs exacto que esa
#    versión necesita: los dos van emparejados.
#  - Comprueba con una búsqueda real que sigue sacando el audio.
#  - Si la nueva no funciona y la anterior sí, vuelve a la anterior.
#
#  No hace falta reiniciar el servicio: el servidor lanza yt-dlp como un
#  proceso nuevo en cada descarga, así que la siguiente ya usa la versión nueva.
# ============================================================
set -uo pipefail

RAIZ="${RAIZ:-/var/www/vhosts/dannarita.es/music.dannarita.es}"
PY="$RAIZ/.venv/bin/python"
PRUEBA="${PRUEBA:-ytsearch1:rick astley never gonna give you up}"
PIP=("$PY" -m pip install --quiet --disable-pip-version-check)

log() { echo "[actualizar-yt-dlp] $*"; }
version() { "$PY" -c "import importlib.metadata as m; print(m.version('$1'))" 2>/dev/null || echo ""; }

# ¿Sigue sacando el formato de audio de un vídeo real? Es justo lo que se rompe.
# Con las mismas opciones que usa server.py al descargar (motor de JavaScript y
# componente EJS), y exigiendo que imprima algo: salir con 0 no basta.
funciona() {
    local salida
    salida="$(timeout 120 "$PY" -m yt_dlp --no-warnings --no-playlist --skip-download \
        --js-runtimes node --remote-components ejs:github \
        -f bestaudio --print "%(format_id)s %(title)s" "$PRUEBA" 2>/dev/null)" || return 1
    [ -n "$salida" ]
}

antes="$(version yt-dlp)"
ejs_antes="$(version yt-dlp-ejs)"

if ! "${PIP[@]}" --upgrade "yt-dlp[default]"; then
    log "ERROR: pip no pudo actualizar; se queda la ${antes:-desconocida}"
    exit 1
fi
despues="$(version yt-dlp)"
ejs_despues="$(version yt-dlp-ejs)"

if [ "$antes" = "$despues" ]; then
    if funciona; then
        log "al día ($despues) y funcionando"
        exit 0
    fi
    log "ERROR: $despues es la última versión pero no consigue extraer audio de YouTube"
    exit 1
fi

log "actualizado: yt-dlp $antes -> $despues, yt-dlp-ejs $ejs_antes -> $ejs_despues"
if funciona; then
    log "comprobado: extrae audio correctamente"
    exit 0
fi

log "AVISO: $despues no consigue extraer audio; se prueba la anterior ($antes)"
anterior=("yt-dlp==$antes")
[ -n "$ejs_antes" ] && anterior+=("yt-dlp-ejs==$ejs_antes")
"${PIP[@]}" "${anterior[@]}"
if funciona; then
    log "se vuelve a $antes, que sí funciona"
    exit 1   # fallo visible en systemctl: la nueva no sirve
fi

# Si ninguna funciona, YouTube ha cambiado algo: la más nueva es la que antes
# recibirá el arreglo, así que se deja instalada
log "ERROR: ni $despues ni $antes funcionan; se deja $despues"
"${PIP[@]}" --upgrade "yt-dlp[default]"
exit 1
