#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_NAME="${PI_WEB_TMUX_SESSION:-pi-web}"
LOG_FILE="${PI_WEB_LOG_FILE:-/home/yiang/pi-web-host.log}"
NODE_CA_FILE="${NODE_EXTRA_CA_CERTS:-/home/yiang/.local/share/mkcert/rootCA.pem}"
BUILD=false
RESTART=false

usage() {
  cat <<'EOF'
Usage: ./run-host.sh [--build] [--restart]

Starts Pi Web in a detached tmux session named pi-web.

  --build    Build the production bundle first. Implies --restart.
  --restart  Stop the existing pi-web tmux session before starting.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --build)
      BUILD=true
      RESTART=true
      ;;
    --restart)
      RESTART=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v tmux >/dev/null || {
  printf 'tmux is required to run Pi Web persistently.\n' >&2
  exit 1
}

if ! BIND_HOST="${PI_WEB_BIND_HOST:-$(ip -4 -o addr show docker0 2>/dev/null | awk '{split($4, address, "/"); print address[1]; exit}')}"; then
  printf 'Unable to determine the Docker gateway address. Set PI_WEB_BIND_HOST explicitly.\n' >&2
  exit 1
fi

if [[ -z "$BIND_HOST" ]]; then
  printf 'Docker bridge docker0 has no IPv4 address. Set PI_WEB_BIND_HOST explicitly.\n' >&2
  exit 1
fi

if [[ ! -r "$NODE_CA_FILE" ]]; then
  printf 'mkcert root CA is not readable: %s\n' "$NODE_CA_FILE" >&2
  exit 1
fi

if [[ "$BUILD" == true ]]; then
  (cd "$ROOT_DIR" && npm run build)
elif [[ ! -f "$ROOT_DIR/.next/BUILD_ID" ]]; then
  printf 'Production build output is missing. Run: %s --build\n' "$0" >&2
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if [[ "$RESTART" != true ]]; then
    printf 'Pi Web is already running in tmux session "%s". Use --restart to replace it.\n' "$SESSION_NAME"
    exit 0
  fi
  tmux kill-session -t "$SESSION_NAME"
fi

for _ in {1..20}; do
  if ! ss -ltn "( sport = :30141 )" | grep -q ':30141'; then
    break
  fi
  sleep 0.25
done

if ss -ltn "( sport = :30141 )" | grep -q ':30141'; then
  printf 'Port 30141 is occupied outside tmux session "%s". Stop that process first.\n' "$SESSION_NAME" >&2
  exit 1
fi

start_command="exec env NODE_EXTRA_CA_CERTS=\"$NODE_CA_FILE\" PI_WEB_NO_OPEN=1 PI_WEB_ALLOWED_HOSTS=server.lc,pi.lc \"$ROOT_DIR/node_modules/.bin/next\" start -H \"$BIND_HOST\" -p 30141 >> \"$LOG_FILE\" 2>&1"
tmux new-session -d -s "$SESSION_NAME" -c "$ROOT_DIR" "$start_command"

printf 'Pi Web started in tmux session "%s".\n' "$SESSION_NAME"
printf 'Bound to %s:30141; nginx serves it at https://pi.lc.\n' "$BIND_HOST"
printf 'Log: %s\n' "$LOG_FILE"
