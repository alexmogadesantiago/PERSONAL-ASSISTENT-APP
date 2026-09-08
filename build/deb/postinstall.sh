#!/bin/sh
# postinstall del paquete .deb: registra el servicio y avisa al usuario.
set -e
if [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/automation-platform.service <<'UNIT'
[Unit]
Description=Personal Assistant (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/automation-platform
ExecStart=/usr/bin/env sh -c 'docker compose up -d'
ExecStop=/usr/bin/env sh -c 'docker compose stop'

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload || true
fi
echo ""
echo "  Personal Assistant instalado en /opt/automation-platform"
echo "  Completa la configuracion:  sudo automation-platform-install"
echo ""
exit 0
