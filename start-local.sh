#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${SCRIPT_DIR}/.local-run"
PID_FILE="${RUN_DIR}/start-local.pid"
LOG_FILE="${RUN_DIR}/start-local.log"
ACTION="background"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
    cat <<EOF
Usage: ./start-local.sh [option]

Options:
  --background   Start in background (default)
  --foreground   Start in foreground
  --stop         Stop the background process
  --status       Show background process status
  --logs         Follow background logs
  --help         Show this help
EOF
}

parse_args() {
    if [ "$#" -eq 0 ]; then
        return 0
    fi

    if [ "$#" -ne 1 ]; then
        print_error "Use a single option at a time."
        usage
        exit 1
    fi

    case "$1" in
        --background)
            ACTION="background"
            ;;
        --foreground)
            ACTION="foreground"
            ;;
        --stop)
            ACTION="stop"
            ;;
        --status)
            ACTION="status"
            ;;
        --logs)
            ACTION="logs"
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
}

check_prereqs() {
    if ! command -v node >/dev/null 2>&1; then
        print_error "Node.js is required to run locally."
        exit 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm is required to run locally."
        exit 1
    fi

    print_success "Using Node $(node --version) and npm $(npm --version)"
}

install_dependencies_if_needed() {
    if [ -d "${SCRIPT_DIR}/node_modules" ]; then
        print_success "node_modules already present"
        return 0
    fi

    print_status "Installing npm dependencies..."
    npm install
}

prepare_local_dirs() {
    mkdir -p \
        "${RUN_DIR}" \
        "${SCRIPT_DIR}/data/configs" \
        "${SCRIPT_DIR}/data/operations" \
        "${SCRIPT_DIR}/data/logs" \
        "${SCRIPT_DIR}/data/cache" \
        "${SCRIPT_DIR}/data/mirrors/default" \
        "${SCRIPT_DIR}/data/mirrors/custom" \
        "${SCRIPT_DIR}/mirror"
}

export_runtime_env() {
    export PORT="${PORT:-3001}"
    export STORAGE_DIR="${STORAGE_DIR:-${SCRIPT_DIR}/data}"
    export OC_MIRROR_CACHE_DIR="${OC_MIRROR_CACHE_DIR:-${SCRIPT_DIR}/data/cache}"
    export OC_MIRROR_BASE_MIRROR_DIR="${OC_MIRROR_BASE_MIRROR_DIR:-${SCRIPT_DIR}/data/mirrors}"
    export OC_MIRROR_EPHEMERAL_DIR="${OC_MIRROR_EPHEMERAL_DIR:-${SCRIPT_DIR}/mirror}"
    export OC_MIRROR_AUTHFILE="${OC_MIRROR_AUTHFILE:-${SCRIPT_DIR}/pull-secret/pull-secret.json}"
    export OC_MIRROR_WORKDIR="${OC_MIRROR_WORKDIR:-${SCRIPT_DIR}}"
}

print_runtime_notes() {
    if [ ! -f "${SCRIPT_DIR}/catalog-data/catalog-index.json" ]; then
        print_warning "catalog-data/catalog-index.json not found; catalog APIs may fall back to static data"
    else
        print_success "Using existing catalog-data from the repository"
    fi

    if [ ! -f "${SCRIPT_DIR}/pull-secret/pull-secret.json" ]; then
        print_warning "pull-secret/pull-secret.json not found; oc-mirror operations will fail until you add it"
    fi

    if ! command -v oc-mirror >/dev/null 2>&1; then
        print_warning "oc-mirror is not installed on the host; UI development works, but mirror operations will fail"
    fi

    if ! command -v oc >/dev/null 2>&1; then
        print_warning "oc is not installed on the host; some system checks may be unavailable"
    fi
}

get_pid() {
    if [ -f "${PID_FILE}" ]; then
        tr -d '[:space:]' < "${PID_FILE}"
    fi
}

get_pgid() {
    local pid="${1:-}"

    if [ -z "${pid}" ]; then
        return 1
    fi

    ps -o pgid= -p "${pid}" 2>/dev/null | tr -d '[:space:]'
}

is_running() {
    local pid
    pid="$(get_pid)"

    if [ -z "${pid}" ]; then
        return 1
    fi

    kill -0 "${pid}" 2>/dev/null
}

cleanup_stale_pid() {
    if [ ! -f "${PID_FILE}" ]; then
        return 0
    fi

    if is_running; then
        return 0
    fi

    print_warning "Removing stale PID file"
    rm -f "${PID_FILE}"
}

show_runtime_summary() {
    print_status "Frontend: http://localhost:3000"
    print_status "API: http://localhost:${PORT}"
    print_status "Storage: ${STORAGE_DIR}"
    print_status "Mirror root: ${OC_MIRROR_BASE_MIRROR_DIR}"
    print_status "Log file: ${LOG_FILE}"
}

start_foreground() {
    if is_running; then
        print_error "start-local is already running in background (PID $(get_pid))."
        print_status "Use ./start-local.sh --stop first, or inspect logs with ./start-local.sh --logs"
        exit 1
    fi

    print_status "Starting local development servers in foreground..."
    show_runtime_summary
    npm run dev
}

start_background() {
    cleanup_stale_pid

    if is_running; then
        print_warning "start-local is already running in background (PID $(get_pid))."
        show_status
        return 0
    fi

    : > "${LOG_FILE}"

    print_status "Starting local development servers in background..."
    show_runtime_summary

    nohup env \
        PORT="${PORT}" \
        STORAGE_DIR="${STORAGE_DIR}" \
        OC_MIRROR_CACHE_DIR="${OC_MIRROR_CACHE_DIR}" \
        OC_MIRROR_BASE_MIRROR_DIR="${OC_MIRROR_BASE_MIRROR_DIR}" \
        OC_MIRROR_EPHEMERAL_DIR="${OC_MIRROR_EPHEMERAL_DIR}" \
        OC_MIRROR_AUTHFILE="${OC_MIRROR_AUTHFILE}" \
        OC_MIRROR_WORKDIR="${OC_MIRROR_WORKDIR}" \
        bash -lc "cd \"${SCRIPT_DIR}\" && exec npm run dev" \
        > "${LOG_FILE}" 2>&1 < /dev/null &

    local pid=$!
    echo "${pid}" > "${PID_FILE}"

    sleep 2

    if is_running; then
        print_success "start-local is running in background (PID ${pid})"
        print_status "Check status: ./start-local.sh --status"
        print_status "Follow logs: ./start-local.sh --logs"
        return 0
    fi

    print_error "Background start failed. Recent log output:"
    rm -f "${PID_FILE}"
    tail -n 40 "${LOG_FILE}" || true
    exit 1
}

stop_background() {
    cleanup_stale_pid

    if ! is_running; then
        print_warning "start-local is not running"
        return 0
    fi

    local pid
    pid="$(get_pid)"

    print_status "Stopping start-local (PID ${pid})..."

    pkill -TERM -P "${pid}" 2>/dev/null || true
    kill -TERM "${pid}" 2>/dev/null || true

    for _ in 1 2 3 4 5 6 7 8 9 10; do
        if ! is_running; then
            rm -f "${PID_FILE}"
            print_success "start-local stopped"
            return 0
        fi
        sleep 1
    done

    print_warning "Process did not stop gracefully; forcing shutdown"
    pkill -KILL -P "${pid}" 2>/dev/null || true
    kill -KILL "${pid}" 2>/dev/null || true

    rm -f "${PID_FILE}"
    print_success "start-local force-stopped"
}

show_status() {
    cleanup_stale_pid

    if is_running; then
        local pid
        local pgid
        pid="$(get_pid)"
        pgid="$(get_pgid "${pid}")"
        print_success "start-local is running"
        print_status "PID: ${pid}"
        if [ -n "${pgid}" ]; then
            print_status "Process group: ${pgid}"
        fi
        print_status "Log file: ${LOG_FILE}"
        print_status "Foreground mode: ./start-local.sh --foreground"
        return 0
    fi

    print_warning "start-local is not running"
}

follow_logs() {
    if [ ! -f "${LOG_FILE}" ]; then
        print_error "No log file found at ${LOG_FILE}"
        exit 1
    fi

    print_status "Following ${LOG_FILE}"
    tail -n 50 -f "${LOG_FILE}"
}

main() {
    parse_args "$@"
    cd "${SCRIPT_DIR}"
    prepare_local_dirs

    case "${ACTION}" in
        background)
            check_prereqs
            install_dependencies_if_needed
            export_runtime_env
            print_runtime_notes
            start_background
            ;;
        foreground)
            check_prereqs
            install_dependencies_if_needed
            export_runtime_env
            print_runtime_notes
            start_foreground
            ;;
        stop)
            stop_background
            ;;
        status)
            show_status
            ;;
        logs)
            follow_logs
            ;;
    esac
}

main "$@"
