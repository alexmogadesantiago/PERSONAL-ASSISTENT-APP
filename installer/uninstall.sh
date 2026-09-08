#!/bin/sh
# Personal Assistant - desinstalador (Linux / Raspberry Pi).
#   ./installer/uninstall.sh [--purge-data] [--yes]
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=installer/lib.sh
. "$SCRIPT_DIR/lib.sh"

PURGE=0; YES=0
for a in "$@"; do case "$a" in --purge-data) PURGE=1 ;; --yes) YES=1 ;; esac; done

ap_log "Desinstalando Personal Assistant" STEP
if [ "$YES" = "0" ]; then
  [ "$PURGE" = "1" ] && echo "Esto PARARÁ los servicios y BORRARÁ TODOS LOS DATOS." \
                     || echo "Esto parará y eliminará los contenedores. Los datos se conservan."
  printf 'Escribe "si" para continuar: '; read -r ans || ans=""
  [ "$ans" = "si" ] || { ap_log "Cancelado."; exit 0; }
fi

ap_detect
if ap_container_engine; then
  cd "$REPO_ROOT"
  ap_step "Parando contenedores"
  if [ "$PURGE" = "1" ]; then $AP_COMPOSE down --remove-orphans -v; else $AP_COMPOSE down --remove-orphans; fi
  $AP_ENGINE image rm pa-playwright-scraper:local pa-profile:local 2>/dev/null || true
  ap_ok "Contenedores eliminados"
else
  ap_warn "Motor de contenedores no disponible; se omite."
fi

ap_step "Eliminando servicio de arranque"
if [ -d /run/systemd/system ]; then
  SYSTEMCTL="systemctl --user"; UNIT_DIR="$HOME/.config/systemd/user"
  [ "$(id -u)" = "0" ] && { SYSTEMCTL="systemctl"; UNIT_DIR="/etc/systemd/system"; }
  $SYSTEMCTL disable automation-platform.service 2>/dev/null || true
  rm -f "$UNIT_DIR/automation-platform.service"
  $SYSTEMCTL daemon-reload 2>/dev/null || true
  ap_ok "servicio systemd eliminado"
fi

if [ "$PURGE" = "1" ]; then
  rm -f "$REPO_ROOT"/output/marca-personal/*.md 2>/dev/null || true
  rm -rf "$AP_HOME"
  ap_ok "datos y estado eliminados"
else
  rm -f "$AP_STATE"
fi
ap_log "Desinstalación completada. El repositorio y tu .env no se han tocado." OK
