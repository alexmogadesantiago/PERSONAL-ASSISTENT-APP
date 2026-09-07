#!/bin/sh
# lib.sh - utilidades compartidas del instalador (Linux / Raspberry Pi).
# POSIX sh. Sin bashismos.

AP_HOME="${AUTOMATION_PLATFORM_HOME:-$HOME/.local/share/automation-platform}"
AP_STATE="$AP_HOME/state.json"
AP_LOG="$AP_HOME/install.log"

ap_init_home() { mkdir -p "$AP_HOME"; }

# --- logging (oculta secretos) -------------------------------------------
ap_redact() {
  sed -E \
    -e 's/([A-Z0-9_]*(PASSWORD|API_KEY|TOKEN|SECRET|ENCRYPTION_KEY)[A-Z0-9_]*[[:space:]]*[=:][[:space:]]*)[^[:space:]]+/\1***/g' \
    -e 's/[0-9]{8,10}:AA[A-Za-z0-9_-]{20,}/***telegram-token***/g' \
    -e 's/AQ\.[A-Za-z0-9_-]{10,}/***gemini-key***/g' \
    -e 's/AIza[A-Za-z0-9_-]{20,}/***gemini-key***/g' \
    -e 's/nvapi-[A-Za-z0-9_-]{20,}/***nvidia-nim-key***/g' \
    -e 's/sk-or-[A-Za-z0-9_-]{20,}/***openrouter-key***/g' \
    -e 's/acs_[A-Za-z0-9_-]{20,}/***service-token***/g'
}

ap_log() {
  ap_init_home
  _lvl="${2:-INFO}"; _comp="${3:-installer}"
  _line="$(date +%Y-%m-%dT%H:%M:%S) [$_lvl] $_comp $(printf '%s' "$1" | ap_redact)"
  printf '%s\n' "$_line" | tee -a "$AP_LOG"
}
ap_step() { ap_log "==> $1" STEP; }
ap_ok()   { ap_log "   $1" OK; }
ap_warn() { ap_log "   $1" WARN; }
ap_err()  { ap_log "$1" ERROR; }

# --- estado reanudable --------------------------------------------------
AP_STEPS="detecting dependencies directories configuring ports building starting-services importing-workflows health-check ready"

ap_set_state() {
  ap_init_home
  _now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"step":"%s","updatedAt":"%s"}\n' "$1" "$_now" > "$AP_STATE"
}
ap_get_state() {
  [ -f "$AP_STATE" ] && sed -n 's/.*"step":"\([^"]*\)".*/\1/p' "$AP_STATE" || printf ''
}

# --- detección de plataforma -----------------------------------------
ap_detect() {
  AP_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  _m="$(uname -m)"
  case "$_m" in
    x86_64|amd64)        AP_ARCH="x64" ;;
    aarch64|arm64)       AP_ARCH="arm64" ;;
    armv7l|armv6l|armhf) AP_ARCH="arm32-UNSUPPORTED" ;;
    i386|i686)           AP_ARCH="x86-UNSUPPORTED" ;;
    *)                   AP_ARCH="$_m" ;;
  esac
  AP_IS_PI=0
  if [ -f /proc/device-tree/model ] && grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then AP_IS_PI=1; fi
  if [ -f /sys/firmware/devicetree/base/model ] && grep -qi 'raspberry pi' /sys/firmware/devicetree/base/model 2>/dev/null; then AP_IS_PI=1; fi
  AP_RAM_GB="$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo '?')"
  AP_DISK_GB="$(df -Pk . | awk 'NR==2 {printf "%.1f", $4/1024/1024}')"
  AP_ROOT=0; [ "$(id -u)" = "0" ] && AP_ROOT=1
  AP_HAS_SYSTEMD=0; [ -d /run/systemd/system ] && AP_HAS_SYSTEMD=1
  AP_ONLINE=0
  if command -v curl >/dev/null 2>&1; then curl -sf -m 4 -o /dev/null https://1.1.1.1 && AP_ONLINE=1
  elif command -v wget >/dev/null 2>&1; then wget -q -T 4 -O /dev/null https://1.1.1.1 && AP_ONLINE=1; fi
  AP_HOSTNAME="$(hostname 2>/dev/null || echo unknown)"
}

# --- Docker / Podman -------------------------------------------------
ap_container_engine() {
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then AP_ENGINE="docker"; AP_COMPOSE="docker compose"; return 0; fi
  fi
  if command -v podman >/dev/null 2>&1; then
    AP_ENGINE="podman"
    if command -v podman-compose >/dev/null 2>&1; then AP_COMPOSE="podman-compose"
    elif podman compose version >/dev/null 2>&1; then AP_COMPOSE="podman compose"
    else return 2; fi
    return 0
  fi
  AP_ENGINE=""; AP_COMPOSE=""; return 1
}

ap_install_docker() {
  # Solo en Linux, con permisos y de forma no sorpresiva.
  [ "$AP_ROOT" = "1" ] || { ap_err "Se necesitan permisos de root para instalar Docker."; return 1; }
  if ! [ "$AP_ONLINE" = "1" ]; then ap_err "Sin conexión para descargar Docker."; return 1; fi
  ap_step "Instalando Docker con el script oficial (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
}

# --- puertos --------------------------------------------------------
ap_port_free() {
  _p="$1"
  if command -v ss >/dev/null 2>&1; then ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$_p\$"
  elif command -v netstat >/dev/null 2>&1; then ! netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$_p\$"
  else (exec 3<>"/dev/tcp/127.0.0.1/$_p") 2>/dev/null && { exec 3>&-; return 1; } || return 0
  fi
}
ap_free_port() {
  _want="$1"; ap_port_free "$_want" && { echo "$_want"; return; }
  _p=$((_want+1)); _end=$((_want+50))
  while [ "$_p" -le "$_end" ]; do ap_port_free "$_p" && { echo "$_p"; return; }; _p=$((_p+1)); done
  echo "$_want"
}

# --- health checks --------------------------------------------------
ap_http_ok() {
  _url="$1"
  if command -v curl >/dev/null 2>&1; then curl -sf -m 5 -o /dev/null "$_url"
  else wget -q -T 5 -O /dev/null "$_url"; fi
}
ap_wait_healthy() {
  _name="$1"; _timeout="${2:-200}"; _t=0
  while [ "$_t" -lt "$_timeout" ]; do
    _s="$($AP_ENGINE inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$_name" 2>/dev/null)"
    case "$_s" in healthy|running) return 0 ;; esac
    sleep 4; _t=$((_t+4))
  done
  return 1
}
