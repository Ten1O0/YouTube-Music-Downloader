#!/usr/bin/env bash
# ============================================================
#  Instala en el VPS la comprobación de listas seguidas (plan 14).
#
#  Uso (desde la raíz del proyecto, después de desplegar backend/tareas.py
#  y backend/listas_youtube.py):
#    ./scripts/servidor/instalar-comprobar-listas.sh
#
#  Sube comprobar-listas.sh y crea un servicio de un solo uso y un temporizador
#  que lo lanza cada hora (con hasta 10 minutos de margen aleatorio).
#
#  Consultar:  ssh vps 'systemctl list-timers comprobar-listas.timer'
#              ssh vps 'journalctl -u comprobar-listas -n 20'
# ============================================================
set -euo pipefail

VPS="${VPS:-root@213.165.80.130}"
REMOTE="/var/www/vhosts/dannarita.es/music.dannarita.es"

cd "$(dirname "$0")/../.."

ssh "$VPS" "mkdir -p '$REMOTE/scripts/servidor'"
scp -q scripts/servidor/comprobar-listas.sh "$VPS:$REMOTE/scripts/servidor/comprobar-listas.sh"

ssh "$VPS" bash -s <<EOF_REMOTO
set -euo pipefail
chmod 755 '$REMOTE/scripts/servidor/comprobar-listas.sh'

cat > /etc/systemd/system/comprobar-listas.service <<'UNIDAD'
[Unit]
Description=Comprueba las listas de YouTube seguidas y apunta lo nuevo
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$REMOTE/scripts/servidor/comprobar-listas.sh
Nice=10
UNIDAD

cat > /etc/systemd/system/comprobar-listas.timer <<'UNIDAD'
[Unit]
Description=Comprobación de listas seguidas, cada hora

[Timer]
OnCalendar=hourly
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIDAD

systemctl daemon-reload
systemctl enable --now comprobar-listas.timer
EOF_REMOTO

echo "Instalado. Próxima ejecución:"
ssh "$VPS" "systemctl list-timers comprobar-listas.timer --no-pager | head -2"
