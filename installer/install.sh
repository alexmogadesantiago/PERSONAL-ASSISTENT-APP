#!/bin/sh
# ============================================================================
#  Automation Platform - instalador para Linux x64/ARM64 y Raspberry Pi ARM64
#  Uso:  ./installer/install.sh [--unattended] [--config FILE] [--reconfigure]
#                               [--force] [--no-browser]
#  Los secretos, en modo --unattended, se leen de variables de entorno o de
#  --config FILE (JSON plano: {"AC_NVIDIA_NIM_API_KEY":"...", ...}).
# ============================================================================
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=installer/lib.sh
. "$SCRIPT_DIR/lib.sh"

VERSION="$(tr -d ' \n' < "$REPO_ROOT/VERSION")"
UNATTENDED=0; CONFIG_FILE=""; RECONFIGURE=0; FORCE=0; OPEN_BROWSER=1
while [ $# -gt 0 ]; do
  case "$1" in
    --unattended) UNATTENDED=1 ;;
    --config) shift; CONFIG_FILE="$1" ;;
    --reconfigure) RECONFIGURE=1 ;;
    --force) FORCE=1 ;;
    --no-browser) OPEN_BROWSER=0 ;;
    *) echo "opción desconocida: $1" >&2; exit 64 ;;
  esac
  shift
done

ap_init_home
ap_log "Automation Platform installer v$VERSION" STEP
[ "$FORCE" = "1" ] || { _st="$(ap_get_state)"; [ -n "$_st" ] && ap_warn "Reanudando: último paso = '$_st'"; }

rand_secret() { head -c 48 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 48; }

env_get() { grep -E "^$1=" "$REPO_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- || true; }
env_set() {
  _k="$1"; _v="$2"; _f="$REPO_ROOT/.env"
  touch "$_f"
  if grep -qE "^$_k=" "$_f"; then
    _tmp="$(mktemp)"; grep -vE "^$_k=" "$_f" > "$_tmp"; mv "$_tmp" "$_f"
  fi
  printf '%s=%s\n' "$_k" "$_v" >> "$_f"
}
cfg_get() {
  [ -n "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ] || return 1
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$CONFIG_FILE" | head -1
}

# --- 1. DETECTING --------------------------------------------------------
ap_set_state detecting
ap_step "Detectando plataforma"
ap_detect
ap_log "   OS=$AP_OS arch=$AP_ARCH pi=$AP_IS_PI RAM=${AP_RAM_GB}GB disco=${AP_DISK_GB}GB root=$AP_ROOT systemd=$AP_HAS_SYSTEMD online=$AP_ONLINE"
case "$AP_ARCH" in
  x64|arm64) ;;
  *) ap_err "Arquitectura no soportada: $AP_ARCH (solo x64 y arm64)."; exit 2 ;;
esac
case "${AP_DISK_GB%.*}" in ''|*[!0-9]*) : ;; *) [ "${AP_DISK_GB%.*}" -lt 5 ] && { ap_err "Espacio insuficiente (${AP_DISK_GB}GB, se necesitan 5)."; exit 2; } ;; esac
ap_ok "Plataforma OK"

# --- 2. DEPENDENCIES -------------------------------------------------
ap_set_state dependencies
ap_step "Comprobando motor de contenedores"
if ! ap_container_engine; then
  rc=$?
  if [ "$rc" = "1" ]; then
    ap_warn "No hay Docker ni Podman."
    if [ "$AP_ROOT" = "1" ] && [ "$AP_ONLINE" = "1" ]; then
      ap_install_docker && ap_container_engine || { ap_err "BLOCKED BY: instala Docker manualmente y reintenta."; exit 2; }
    else
      ap_err "BLOCKED BY: instala Docker (https://get.docker.com) o Podman y reintenta."
      exit 2
    fi
  else
    ap_err "BLOCKED BY: Podman sin compose. Instala 'podman-compose'."
    exit 2
  fi
fi
ap_ok "Motor: $AP_ENGINE  ·  compose: $AP_COMPOSE"

# --- 3. DIRECTORIES ------------------------------------------------
ap_set_state directories
ap_step "Preparando directorios"
mkdir -p "$REPO_ROOT/config" "$REPO_ROOT/output/marca-personal"
[ -f "$REPO_ROOT/config/user_profile.json" ] || cp "$REPO_ROOT/config/user_profile.example.json" "$REPO_ROOT/config/user_profile.json"
ap_ok "Directorios OK"

# --- 4. CONFIGURING (.env) --------------------------------------
ap_set_state configuring
ap_step "Configurando .env"
NEED_ENV=0
[ -f "$REPO_ROOT/.env" ] || NEED_ENV=1
[ "$RECONFIGURE" = "1" ] && NEED_ENV=1
if [ "$NEED_ENV" = "1" ]; then
  [ -n "$(env_get POSTGRES_DB)" ]   || env_set POSTGRES_DB assistant
  [ -n "$(env_get POSTGRES_USER)" ] || env_set POSTGRES_USER assistant
  [ -n "$(env_get N8N_HOST)" ]      || env_set N8N_HOST localhost
  # El backend decide el proveedor de IA; n8n solo necesita saber donde esta.
  [ -n "$(env_get AC_API_URL)" ]    || env_set AC_API_URL http://backend:8080
  [ -n "$(env_get TZ)" ]            || env_set TZ "$(cat /etc/timezone 2>/dev/null || echo Europe/Madrid)"
  [ -n "$(env_get POSTGRES_PASSWORD)" ]  || env_set POSTGRES_PASSWORD "$(rand_secret)"
  [ -n "$(env_get N8N_ENCRYPTION_KEY)" ] || env_set N8N_ENCRYPTION_KEY "$(rand_secret)"
  # Token con el que n8n llama a /api/ai/generate. Lo genera el instalador
  # para que el usuario no tenga que copiar nada entre servicios.
  [ -n "$(env_get AC_SERVICE_TOKEN)" ]   || env_set AC_SERVICE_TOKEN "acs_$(rand_secret)"

  # La clave del proveedor de IA es OPCIONAL: lo normal es configurarla desde
  # el panel (Settings -> Artificial Intelligence), que la guarda cifrada en la
  # base de datos. Dejarla vacia no bloquea el arranque.
  k="AC_NVIDIA_NIM_API_KEY"
  if [ -z "$(env_get "$k")" ]; then
    val=""
    if v="$(cfg_get "$k")" && [ -n "$v" ]; then val="$v"
    elif [ -n "${AC_NVIDIA_NIM_API_KEY:-}" ]; then val="$AC_NVIDIA_NIM_API_KEY"
    elif [ "$UNATTENDED" = "0" ]; then
      printf '   %s - (opcional) API key de NVIDIA NIM: https://build.nvidia.com\n' "$k"
      printf '   %s (Enter para configurarlo luego desde el panel): ' "$k"
      read -r val || val=""
    fi
    env_set "$k" "$val"
  fi

  MISSING=""
  for spec in \
    "TELEGRAM_CHAT_ID|Tu chat id de Telegram" \
    "TELEGRAM_NOTICIAS_TOKEN|Token del bot de Noticias" \
    "TELEGRAM_TOKEN_MARCA|Token del bot de Marca Personal" \
    "TELEGRAM_TOKEN_LABORAL|Token del bot de Laboral" \
    "TELEGRAM_TOKEN_EMAIL|Token del bot de Email"
  do
    k="${spec%%|*}"; hint="${spec#*|}"
    cur="$(env_get "$k")"
    case "$cur" in ""|*CAMBIA*|*PEGA_AQUI*|*PLACEHOLDER*) ;; *) continue ;; esac
    val=""
    if v="$(cfg_get "$k")" && [ -n "$v" ]; then val="$v"
    elif eval "[ -n \"\${$k:-}\" ]"; then eval "val=\$$k"
    elif [ "$UNATTENDED" = "0" ]; then
      printf '   %s — %s\n   %s (Enter para dejarlo pendiente): ' "$k" "$hint" "$k"
      read -r val || val=""
    fi
    if [ -n "$val" ]; then env_set "$k" "$val"; else env_set "$k" ""; MISSING="$MISSING $k"; fi
  done
  ap_ok ".env escrito"
  for m in $MISSING; do ap_warn "BLOCKED BY: falta $m — el stack arranca pero el workflow que lo usa no funcionará hasta rellenarlo (ver CREDENCIALES.md)."; done
else
  ap_ok ".env ya existe (usa --reconfigure para regenerarlo)"
fi

# --- 5. PORTS ------------------------------------------------------
ap_set_state ports
ap_step "Comprobando puertos"
N8N_WANT="$(env_get N8N_PORT)"; [ -n "$N8N_WANT" ] || N8N_WANT=5678
PROFILE_WANT="$(env_get PROFILE_PORT)"; [ -n "$PROFILE_WANT" ] || PROFILE_WANT=7777
if $AP_ENGINE inspect --format '{{.State.Status}}' pa-n8n 2>/dev/null | grep -q running; then
  N8N_PORT="$N8N_WANT"; PROFILE_PORT="$PROFILE_WANT"
else
  N8N_PORT="$(ap_free_port "$N8N_WANT")"; PROFILE_PORT="$(ap_free_port "$PROFILE_WANT")"
fi
env_set N8N_PORT "$N8N_PORT"
env_set PROFILE_PORT "$PROFILE_PORT"
env_set WEBHOOK_URL "http://localhost:$N8N_PORT/"
[ "$N8N_PORT" = "$N8N_WANT" ] || ap_warn "Puerto $N8N_WANT ocupado -> n8n usará $N8N_PORT"
ap_ok "n8n:$N8N_PORT  profile:$PROFILE_PORT"

# --- 6/7. BUILD + UP --------------------------------------------
cd "$REPO_ROOT"
ap_set_state building
ap_step "Construyendo imágenes"
$AP_COMPOSE build 2>&1 | while IFS= read -r l; do ap_log "   $l"; done

ap_set_state starting-services
ap_step "Levantando servicios"
$AP_COMPOSE up -d 2>&1 | while IFS= read -r l; do ap_log "   $l"; done
for c in pa-postgres pa-playwright pa-profile pa-n8n; do
  if ap_wait_healthy "$c" 200; then ap_ok "$c healthy"; else ap_err "$c no llegó a healthy"; exit 1; fi
done

# --- 8. IMPORT WORKFLOWS --------------------------------------
ap_set_state importing-workflows
ap_step "Importando workflows"
$AP_COMPOSE exec -T n8n n8n import:workflow --separate --input=/files/workflows 2>&1 \
  | grep -vE 'Permissions 0644|Error tracking|too wide|Could not (find|remove)|ActiveWorkflowManager|processTicksAndRejections|^[[:space:]]+at ' \
  | while IFS= read -r l; do ap_log "   $l"; done || true
ap_ok "Workflows importados"

# --- 9. HEALTH CHECKS ----------------------------------------
ap_set_state health-check
ap_step "Health checks"
ALL_OK=1
for c in pa-postgres pa-n8n pa-playwright pa-profile; do
  s="$($AP_ENGINE inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null)"
  case "$s" in healthy|running) ap_ok "container:$c = OK" ;; *) ap_err "container:$c = $s"; ALL_OK=0 ;; esac
done
ap_http_ok "http://localhost:$N8N_PORT/healthz"    && ap_ok "http:n8n = OK"     || { ap_err "http:n8n = FALLO"; ALL_OK=0; }
ap_http_ok "http://localhost:$PROFILE_PORT/health" && ap_ok "http:profile = OK" || { ap_err "http:profile = FALLO"; ALL_OK=0; }
WF_N="$($AP_COMPOSE exec -T n8n n8n list:workflow 2>/dev/null | grep -c Asistente || true)"
[ "${WF_N:-0}" -ge 3 ] && ap_ok "n8n:workflows = $WF_N" || { ap_err "n8n:workflows = $WF_N (esperado >=3)"; ALL_OK=0; }

# --- autostart: systemd (si existe) ----------------------------
ap_step "Registrando arranque automático"
if [ "$AP_HAS_SYSTEMD" = "1" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"; SYSTEMCTL="systemctl --user"; WANTED="default.target"
  if [ "$AP_ROOT" = "1" ]; then UNIT_DIR="/etc/systemd/system"; SYSTEMCTL="systemctl"; WANTED="multi-user.target"; fi
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/automation-platform.service" <<UNIT
[Unit]
Description=Automation Platform (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$REPO_ROOT
ExecStart=/bin/sh -c '$AP_COMPOSE up -d'
ExecStop=/bin/sh -c '$AP_COMPOSE stop'

[Install]
WantedBy=$WANTED
UNIT
  $SYSTEMCTL daemon-reload || true
  $SYSTEMCTL enable automation-platform.service 2>&1 | while IFS= read -r l; do ap_log "   $l"; done || ap_warn "no se pudo habilitar el servicio systemd"
  ap_ok "servicio systemd 'automation-platform' registrado"
else
  ap_warn "systemd no disponible: añade '$AP_COMPOSE up -d' a tu arranque (cron @reboot / rc.local)."
fi

if [ "$ALL_OK" = "1" ]; then
  ap_set_state ready
  ap_log "================  READY  ================" OK
  ap_log "n8n:      http://localhost:$N8N_PORT" OK
  ap_log "perfil:   http://localhost:$PROFILE_PORT" OK
  [ "$OPEN_BROWSER" = "1" ] && command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$N8N_PORT" >/dev/null 2>&1 || true
  exit 0
else
  ap_err "FINAL STATUS: BLOCKED — algún health check falló. Revisa $AP_LOG"
  exit 1
fi
