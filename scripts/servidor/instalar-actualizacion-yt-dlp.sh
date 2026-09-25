#!/usr/bin/env bash
# ============================================================
#  Instala en el VPS la actualización diaria de yt-dlp.
#
#  Uso (desde la raíz del proyecto):
#    ./scripts/servidor/instalar-actualizacion-yt-dlp.sh
#
#  Sube actualizar-yt-dlp.sh y crea dos unidades de systemd: un servicio de un
#  solo uso y un temporizador que lo lanza cada día a las 04:30 UTC (con hasta
#  30 minutos de margen aleatorio). Persistent=true hace que, si el servidor
#  estaba apagado a esa hora, se ejecute al arrancar.
#
#  Consultar:  ssh vps 'systemctl list-timers ytdlp-actualizar.timer'
#              ssh vps 'journalctl -u ytdlp-actualizar -n 20'
# ============================================================
set -euo pipefail

VPS="${VPS:-root@213.165.80.130}"
REMOTE="/var/www/vhosts/dannarita.es/music.dannarita.es"

cd "$(dirname "$0")/../.."

ssh "$VPS" "mkdir -p '$REMOTE/scripts/servidor'"
scp -q scripts/servidor/actualizar-yt-dlp.sh "$VPS:$REMOTE/scripts/servidor/actualizar-yt-dlp.sh"

ssh "$VPS" bash -s <<EOF
set -euo pipefail
chmod 755 '$REMOTE/scripts/servidor/actualizar-yt-dlp.sh'

cat > /etc/systemd/system/ytdlp-actualizar.service <<'UNIDAD'
[Unit]
Description=Actualiza yt-dlp y comprueba que sigue extrayendo audio
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$REMOTE/scripts/servidor/actualizar-yt-dlp.sh
Nice=10
UNIDAD

cat > /etc/systemd/system/ytdlp-actualizar.timer <<'UNIDAD'
[Unit]
Description=Actualización diaria de yt-dlp

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIDAD

systemctl daemon-reload
systemctl enable --now ytdlp-actualizar.timer
EOF

echo "Instalado. Próxima ejecución:"
ssh "$VPS" "systemctl list-timers ytdlp-actualizar.timer --no-pager | head -2"
