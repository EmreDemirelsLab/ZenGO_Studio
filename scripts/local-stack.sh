#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$RUN_DIR/backend.log"
FRONTEND_LOG="$RUN_DIR/frontend.log"

mkdir -p "$RUN_DIR"

is_running() {
  local pid="$1"
  if [[ -z "${pid:-}" ]]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

port_pid() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

read_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then
    tr -d '[:space:]' < "$file"
    return 0
  fi
  return 1
}

start_backend() {
  local pid=""
  pid="$(read_pid "$BACKEND_PID_FILE" || true)"
  if is_running "$pid"; then
    echo "Backend already running (pid: $pid)"
    return 0
  fi

  local port_pid_value=""
  port_pid_value="$(port_pid 3001)"
  if [[ -n "$port_pid_value" ]]; then
    echo "Backend already listening on :3001 (pid: $port_pid_value)"
    return 0
  fi

  echo "Starting backend on :3001 ..."
  (
    cd "$ROOT_DIR/backend"
    nohup npm start > "$BACKEND_LOG" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"
  )
  echo "Backend started (pid: $(read_pid "$BACKEND_PID_FILE"))"
}

start_frontend() {
  local pid=""
  pid="$(read_pid "$FRONTEND_PID_FILE" || true)"
  if is_running "$pid"; then
    echo "Frontend already running (pid: $pid)"
    return 0
  fi

  local port_pid_value=""
  port_pid_value="$(port_pid 3000)"
  if [[ -n "$port_pid_value" ]]; then
    echo "Frontend already listening on :3000 (pid: $port_pid_value)"
    return 0
  fi

  echo "Starting frontend dev server on :3000 ..."
  (
    cd "$ROOT_DIR/frontend"
    REACT_APP_API_URL="http://localhost:3001" nohup npm run dev > "$FRONTEND_LOG" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
  )
  echo "Frontend started (pid: $(read_pid "$FRONTEND_PID_FILE"))"
}

stop_one() {
  local name="$1"
  local pid_file="$2"

  local pid=""
  pid="$(read_pid "$pid_file" || true)"
  if ! is_running "$pid"; then
    echo "$name is not running."
    rm -f "$pid_file"
    return 0
  fi

  echo "Stopping $name (pid: $pid) ..."
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! is_running "$pid"; then
      break
    fi
    sleep 0.2
  done

  if is_running "$pid"; then
    echo "$name did not stop gracefully, forcing kill."
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$pid_file"
  echo "$name stopped."
}

status_one() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local port="$4"

  local pid=""
  pid="$(read_pid "$pid_file" || true)"
  if is_running "$pid"; then
    echo "$name: RUNNING (pid: $pid, log: $log_file)"
  elif [[ -n "$(port_pid "$port")" ]]; then
    echo "$name: RUNNING (detected via port :$port, not managed by script)"
  else
    echo "$name: STOPPED"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  scripts/local-stack.sh up [--frontend]
  scripts/local-stack.sh down
  scripts/local-stack.sh restart [--frontend]
  scripts/local-stack.sh status
  scripts/local-stack.sh logs [backend|frontend]

Notes:
  - "up" starts backend only by default.
  - Add --frontend to also start the React dev server.
EOF
}

cmd="${1:-}"
arg="${2:-}"

case "$cmd" in
  up)
    start_backend
    if [[ "$arg" == "--frontend" ]]; then
      start_frontend
    fi
    ;;
  down)
    stop_one "Frontend" "$FRONTEND_PID_FILE"
    stop_one "Backend" "$BACKEND_PID_FILE"
    ;;
  restart)
    stop_one "Frontend" "$FRONTEND_PID_FILE"
    stop_one "Backend" "$BACKEND_PID_FILE"
    start_backend
    if [[ "$arg" == "--frontend" ]]; then
      start_frontend
    fi
    ;;
  status)
    status_one "Backend" "$BACKEND_PID_FILE" "$BACKEND_LOG" "3001"
    status_one "Frontend" "$FRONTEND_PID_FILE" "$FRONTEND_LOG" "3000"
    ;;
  logs)
    case "$arg" in
      backend)
        tail -n 120 "$BACKEND_LOG"
        ;;
      frontend)
        tail -n 120 "$FRONTEND_LOG"
        ;;
      *)
        echo "Please choose logs target: backend|frontend"
        exit 1
        ;;
    esac
    ;;
  *)
    usage
    exit 1
    ;;
esac
