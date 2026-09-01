#!/usr/bin/env bash
#
# Interactive, project-local Rhiza deployment wizard for macOS and Linux.
# Generated from the wizard skill template.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()
WRITTEN_SECRET=()
SKIPPED=()

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview      >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open     >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open         >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=6
NODE_MIN_MAJOR=24
PNPM_VERSION=11.19.0
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
STATE_DIR="$PROJECT_ROOT/.rhiza"
RUNTIME_DIR="$STATE_DIR/runtime"
NODE_HOME="$RUNTIME_DIR/node"
TOOLING_DIR="$STATE_DIR/tooling"
PID_FILE="$STATE_DIR/rhiza.pid"
LOG_FILE="$STATE_DIR/rhiza.log"
ENV_FILE="$PROJECT_ROOT/.env"
NODE_BIN=""
PNPM_JS=""
PNPM_BIN=""
SERVICE_PID=""
SERVICE_UNMANAGED=false

cd "$PROJECT_ROOT"

usage() {
  printf 'Rhiza one-click deployment wizard (macOS/Linux)\n\nUsage: %s [--help]\n' "$0"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi
if (( $# )); then usage >&2; exit 2; fi

mkdir -p "$STATE_DIR"

env_value() {
  local key="$1" value
  value=$(_existing "$key" || true)
  if [[ "$value" == \"*\" && ${#value} -ge 2 ]]; then
    value=${value:1:${#value}-2}
    value=${value//\\\"/\"}
    value=${value//\\\\/\\}
  fi
  printf '%s' "$value"
}

ask_config() {
  local key="$1" prompt="$2" current input
  current=$(env_value "$key")
  if [[ -n "$current" ]]; then
    printf '  %s [Enter keeps current]: ' "$prompt"
  else
    printf '  %s: ' "$prompt"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret_config() {
  local key="$1" prompt="$2" current input
  current=$(env_value "$key")
  if [[ -n "$current" ]]; then
    printf '  %s [Enter keeps current]: ' "$prompt"
  else
    printf '  %s: ' "$prompt"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env_string() {
  local key="$1" value="$2"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  write_env "$key" "\"$value\""
}

remove_env() {
  local key="$1" tmp
  [[ -f "$ENV_FILE" ]] || return 0
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  mv "$tmp" "$ENV_FILE"
  say "Removed $key from .env."
}

configured_port() {
  local port
  port=$(env_value API_PORT)
  [[ "$port" =~ ^[0-9]+$ ]] || port=8787
  printf '%s' "$port"
}

is_rhiza_process() {
  local pid="$1" command_line
  command_line=$(ps -p "$pid" -o command= 2>/dev/null || true)
  [[ "$command_line" == *"dist-server/index.js"* ]]
}

health_responds() {
  local port="$1"
  if command -v curl >/dev/null 2>&1; then
    curl --silent --fail --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 2 -O /dev/null "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1
  else
    return 1
  fi
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 1
  fi
}

discover_service() {
  local pid="" port
  SERVICE_PID=""
  SERVICE_UNMANAGED=false
  if [[ -f "$PID_FILE" ]]; then
    read -r pid < "$PID_FILE" || true
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && is_rhiza_process "$pid"; then
      SERVICE_PID="$pid"
      return 0
    fi
    : > "$PID_FILE"
  fi

  port=$(configured_port)
  health_responds "$port" || return 1
  if command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n1 || true)
  elif command -v fuser >/dev/null 2>&1; then
    pid=$(fuser "${port}/tcp" 2>/dev/null | awk '{print $1}' || true)
  fi
  if [[ "$pid" =~ ^[0-9]+$ ]] && is_rhiza_process "$pid"; then
    SERVICE_PID="$pid"
    printf '%s\n' "$pid" > "$PID_FILE"
  else
    SERVICE_UNMANAGED=true
  fi
  return 0
}

stop_service() {
  local pid="$1" attempt
  say "Stopping Rhiza (PID $pid)..."
  kill -TERM "$pid" 2>/dev/null || true
  for attempt in {1..20}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "The service did not stop within 5 seconds. Please stop PID $pid manually."
    return 1
  fi
  : > "$PID_FILE"
  say "Rhiza has stopped."
}

stage "Check running service"
say "Rhiza will only stop a process after verifying its command line."
if discover_service; then
  if [[ "$SERVICE_UNMANAGED" == true ]]; then
    warn "Rhiza answered on port $(configured_port), but its PID could not be verified safely."
    while true; do
      printf '  Choose: [1] restart service  [2] stop service: '
      read -r service_action
      [[ "$service_action" == "1" || "$service_action" == "2" ]] && break
      warn "Enter 1 or 2."
    done
    warn "This service was not started by the deployment wizard, so it will not be terminated automatically."
    warn "Stop it from its original terminal, then run this wizard again."
    pause "Press Enter to exit."
    exit 1
  fi
  while true; do
    printf '  Choose: [1] restart service  [2] stop service: '
    read -r service_action
    case "$service_action" in
      1) stop_service "$SERVICE_PID"; break ;;
      2) stop_service "$SERVICE_PID"; finish; exit 0 ;;
      *) warn "Enter 1 or 2." ;;
    esac
  done
else
  say "No running Rhiza service was found."
fi

resolve_toolchain() {
  NODE_BIN=""
  PNPM_JS=""
  PNPM_BIN=""
  if [[ -x "$NODE_HOME/bin/node" ]]; then
    NODE_BIN="$NODE_HOME/bin/node"
  elif command -v node >/dev/null 2>&1; then
    NODE_BIN=$(command -v node)
  fi
  if [[ -f "$TOOLING_DIR/node_modules/pnpm/bin/pnpm.cjs" ]]; then
    PNPM_JS="$TOOLING_DIR/node_modules/pnpm/bin/pnpm.cjs"
  elif command -v pnpm >/dev/null 2>&1; then
    PNPM_BIN=$(command -v pnpm)
  fi
}

node_is_compatible() {
  [[ -n "$NODE_BIN" ]] || return 1
  local major
  major=$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)
  [[ "$major" =~ ^[0-9]+$ ]] && (( major >= NODE_MIN_MAJOR ))
}

run_pnpm() {
  if [[ -n "$PNPM_JS" ]]; then "$NODE_BIN" "$PNPM_JS" "$@"; else "$PNPM_BIN" "$@"; fi
}

pnpm_is_compatible() {
  [[ -n "$NODE_BIN" ]] || return 1
  [[ -n "$PNPM_JS" || -n "$PNPM_BIN" ]] || return 1
  [[ "$(run_pnpm --version 2>/dev/null || true)" == "$PNPM_VERSION" ]]
}

download_file() {
  local url="$1" destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --output "$destination" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$destination" "$url"
  else
    warn "Automatic installation requires curl or wget."
    return 1
  fi
}

install_portable_node() {
  local os arch base temp checksums archive filename expected actual extracted backup
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) warn "Unsupported operating system: $(uname -s)"; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) warn "Unsupported CPU architecture: $(uname -m)"; return 1 ;;
  esac
  command -v tar >/dev/null 2>&1 || { warn "Automatic installation requires tar."; return 1; }
  temp=$(mktemp -d)
  trap 'rm -rf -- "$temp"' RETURN
  base="https://nodejs.org/dist/latest-v${NODE_MIN_MAJOR}.x"
  checksums="$temp/SHASUMS256.txt"
  download_file "$base/SHASUMS256.txt" "$checksums"
  filename=$(awk -v suffix="-${os}-${arch}.tar.gz" '$2 ~ suffix "$" { print $2; exit }' "$checksums")
  [[ -n "$filename" ]] || { warn "No Node.js archive found for ${os}-${arch}."; return 1; }
  archive="$temp/$filename"
  download_file "$base/$filename" "$archive"
  expected=$(awk -v file="$filename" '$2 == file { print $1 }' "$checksums")
  if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$archive" | awk '{print $1}')
  else warn "SHA-256 verification requires sha256sum or shasum."; return 1
  fi
  [[ "$actual" == "$expected" ]] || { warn "Node.js archive checksum mismatch."; return 1; }
  mkdir -p "$RUNTIME_DIR"
  tar -xzf "$archive" -C "$temp"
  extracted="$temp/${filename%.tar.gz}"
  [[ -x "$extracted/bin/node" ]] || { warn "Downloaded Node.js archive is incomplete."; return 1; }
  if [[ -e "$NODE_HOME" ]]; then
    backup="$RUNTIME_DIR/node.previous.$(date +%Y%m%d%H%M%S)"
    mv "$NODE_HOME" "$backup"
    note "Previous portable Node.js moved to $backup"
  fi
  mv "$extracted" "$NODE_HOME"
  trap - RETURN
  rm -rf -- "$temp"
  NODE_BIN="$NODE_HOME/bin/node"
  say "Installed $("$NODE_BIN" --version) in $NODE_HOME"
}

install_local_pnpm() {
  local npm_cli=""
  mkdir -p "$TOOLING_DIR"
  if [[ "$NODE_BIN" == "$NODE_HOME/bin/node" ]]; then
    npm_cli="$NODE_HOME/lib/node_modules/npm/bin/npm-cli.js"
    [[ -f "$npm_cli" ]] || { warn "The portable Node.js package does not contain npm."; return 1; }
    "$NODE_BIN" "$npm_cli" install --prefix "$TOOLING_DIR" "pnpm@$PNPM_VERSION"
  elif command -v npm >/dev/null 2>&1; then
    npm install --prefix "$TOOLING_DIR" "pnpm@$PNPM_VERSION"
  else
    install_portable_node
    npm_cli="$NODE_HOME/lib/node_modules/npm/bin/npm-cli.js"
    "$NODE_BIN" "$npm_cli" install --prefix "$TOOLING_DIR" "pnpm@$PNPM_VERSION"
  fi
  PNPM_JS="$TOOLING_DIR/node_modules/pnpm/bin/pnpm.cjs"
  say "Installed pnpm $(run_pnpm --version) in $TOOLING_DIR"
}

stage "Check runtime requirements"
resolve_toolchain
missing=()
node_is_compatible || missing+=("Node.js ${NODE_MIN_MAJOR}+")
pnpm_is_compatible || missing+=("pnpm ${PNPM_VERSION}")
[[ -f "$PROJECT_ROOT/node_modules/.modules.yaml" ]] || missing+=("project dependencies")

if (( ${#missing[@]} )); then
  warn "Missing or incompatible: ${missing[*]}"
  if ! confirm "Install the required environment inside this project now?"; then
    warn "The runtime requirements are not satisfied."
    pause "Press Enter to exit."
    exit 1
  fi
  if ! node_is_compatible; then install_portable_node; fi
  resolve_toolchain
  if ! pnpm_is_compatible; then install_local_pnpm; fi
  say "Installing project dependencies..."
  run_pnpm install --frozen-lockfile
  resolve_toolchain
else
  say "Runtime ready: $("$NODE_BIN" --version), pnpm $(run_pnpm --version)."
fi

stage "Choose whether to start"
if ! confirm "Start Rhiza now?"; then
  say "Environment is ready. No service was started."
  finish
  exit 0
fi

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
    say "Created .env from .env.example."
  fi
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1024 && 10#$1 <= 65535 ))
}

custom_configuration() {
  local review_choice provider_choice database_choice
  while true; do
    API_PORT=$(env_value API_PORT); API_PORT=${API_PORT:-8787}
    while true; do
      printf '  API port [%s]: ' "$API_PORT"
      read -r entered_port
      [[ -n "$entered_port" ]] && API_PORT="$entered_port"
      valid_port "$API_PORT" && break
      warn "Port must be an integer from 1024 to 65535."
    done
    printf '  Configure an AI provider now? [y/N] '
    read -r provider_choice
    AI_CONFIGURED=false
    if [[ "$provider_choice" =~ ^[Yy] ]]; then
      ask_config AI_BASE_URL "Provider base URL"
      ask_config AI_MODEL "Model name"
      ask_config AI_PROVIDER_NAME "Provider display name"
      ask_secret_config AI_API_KEY "API key (hidden)"
      AI_CONFIGURED=true
    fi
    printf '  Use an external PostgreSQL database? [y/N] '
    read -r database_choice
    DATABASE_CONFIGURED=false
    DATABASE_URL=""
    if [[ "$database_choice" =~ ^[Yy] ]]; then
      ask_secret_config DATABASE_URL "PostgreSQL connection URL (hidden)"
      [[ -n "$DATABASE_URL" ]] || { warn "DATABASE_URL cannot be empty; embedded PGlite will be used."; }
      [[ -n "$DATABASE_URL" ]] && DATABASE_CONFIGURED=true
    fi

    printf '\n  Configuration summary:\n'
    note "API port: $API_PORT"
    if [[ "$AI_CONFIGURED" == true ]]; then note "AI provider: ${AI_PROVIDER_NAME:-custom} / ${AI_MODEL:-unset} (key hidden)"; else note "AI provider: keep current/default"; fi
    if [[ "$DATABASE_CONFIGURED" == true ]]; then note "Database: external PostgreSQL (URL hidden)"; else note "Database: embedded PGlite"; fi
    printf '  Choose: [1] confirm  [2] return to default settings  [3] edit again  [4] cancel: '
    read -r review_choice
    case "$review_choice" in
      1)
        ensure_env_file
        write_env API_PORT "$API_PORT"
        write_env SERVE_FRONTEND true
        if [[ "$AI_CONFIGURED" == true ]]; then
          write_env_string AI_BASE_URL "$AI_BASE_URL"
          write_env_string AI_MODEL "$AI_MODEL"
          write_env_string AI_PROVIDER_NAME "$AI_PROVIDER_NAME"
          write_env_string AI_API_KEY "$AI_API_KEY"
        fi
        if [[ "$DATABASE_CONFIGURED" == true ]]; then write_env_string DATABASE_URL "$DATABASE_URL"; else remove_env DATABASE_URL; fi
        return 0 ;;
      2) return 2 ;;
      3) continue ;;
      4) return 1 ;;
      *) warn "Enter 1, 2, 3, or 4." ;;
    esac
  done
}

stage "Configure Rhiza"
while true; do
  printf '  Choose: [1] default settings  [2] custom settings: '
  read -r config_mode
  case "$config_mode" in
    1) ensure_env_file; say "Using the current .env values (or defaults from .env.example)."; break ;;
    2)
      set +e
      custom_configuration
      custom_result=$?
      set -e
      if (( custom_result == 0 )); then break; fi
      if (( custom_result == 1 )); then say "Deployment cancelled."; finish; exit 0; fi
      say "Returned to configuration mode selection."
      ;;
    *) warn "Enter 1 or 2." ;;
  esac
done

stage "Build and start service"
resolve_toolchain
port=$(configured_port)
if port_in_use "$port"; then
  warn "Port $port is already in use. Choose another API port and run the wizard again."
  exit 1
fi
say "Creating a production build..."
run_pnpm run build
if [[ -n "$(env_value DATABASE_URL)" ]]; then
  say "Applying PostgreSQL migrations..."
  run_pnpm run db:migrate
fi
: > "$LOG_FILE"
nohup "$NODE_BIN" dist-server/index.js >> "$LOG_FILE" 2>&1 &
SERVICE_PID=$!
printf '%s\n' "$SERVICE_PID" > "$PID_FILE"

started=false
for _ in {1..30}; do
  if health_responds "$port"; then started=true; break; fi
  kill -0 "$SERVICE_PID" 2>/dev/null || break
  sleep 1
done
if [[ "$started" != true ]]; then
  warn "Rhiza did not become healthy. Recent log output:"
  tail -n 30 "$LOG_FILE" 2>/dev/null || true
  exit 1
fi

stage "Deployment complete"
url="http://127.0.0.1:${port}"
say "Rhiza is running at $url"
note "PID: $SERVICE_PID"
note "Log: $LOG_FILE"
open_url "$url"
finish
