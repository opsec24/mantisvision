#!/usr/bin/env bash
# ==============================================================================
# MantisVision - Autonomous Security & Exploit Telemetry Swarm
# Startup, Anti-Sleep Protection & Lifecycle Management Script
# ==============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

CAFFEINATE_PID_FILE="$PROJECT_DIR/.caffeinate.pid"
COLIMA_CONFIG="$HOME/.colima/default/colima.yaml"
TARGET_RAM_GB=4
TARGET_CPU=4

# Colors
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${CYAN}${BOLD}"
    cat << "EOF"
  __  __             _   _     __     ___     _             
 |  \/  |           | | (_)    \ \   / (_)   (_)            
 | |\/| | __ _ _ __ | |_ _ ___  \ \ / / _ ___ _  ___  _ __  
 | |  | |/ _` | '_ \| __| / __|  \ V / | / __| |/ _ \| '_ \ 
 | |  | | (_| | | | | |_| \__ \   \ /  | \__ \ | (_) | | | |
 |_|  |_|\__,_|_| |_|\__|_|___/    V   |_|___/_|\___/|_| |_|
EOF
    echo -e "       ${MAGENTA}Autonomous Security & Exploit Telemetry Swarm${NC}\n"
}

# ------------------------------------------------------------------------------
# Anti-Sleep / Mac Lock Shield (caffeinate)
# Prevents macOS from throttling/sleeping Docker and scans when screen is locked
# ------------------------------------------------------------------------------
start_anti_sleep() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        if [[ -f "$CAFFEINATE_PID_FILE" ]] && kill -0 "$(cat "$CAFFEINATE_PID_FILE" 2>/dev/null)" 2>/dev/null; then
            echo -e " ${GREEN}✓${NC} Anti-Sleep Shield: ${GREEN}Already Active${NC} (PID: $(cat "$CAFFEINATE_PID_FILE"))"
        else
            # -d: prevent display sleep
            # -i: prevent system idle sleep
            # -s: prevent system sleep on AC
            # -u: declare user activity
            caffeinate -disu >/dev/null 2>&1 &
            local pid=$!
            echo "$pid" > "$CAFFEINATE_PID_FILE"
            echo -e " ${GREEN}✓${NC} Anti-Sleep Shield: ${GREEN}Engaged${NC} (PID: $pid)"
            echo -e "   ${CYAN}ℹ Screen lock / App Nap will NOT pause or slow down background scans.${NC}"
        fi
    fi
}

stop_anti_sleep() {
    if [[ -f "$CAFFEINATE_PID_FILE" ]]; then
        local pid
        pid=$(cat "$CAFFEINATE_PID_FILE" 2>/dev/null || true)
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            echo -e " ${YELLOW}•${NC} Anti-Sleep Shield: ${YELLOW}Released${NC} (PID: $pid)"
        fi
        rm -f "$CAFFEINATE_PID_FILE"
    fi
}

check_anti_sleep() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        if [[ -f "$CAFFEINATE_PID_FILE" ]] && kill -0 "$(cat "$CAFFEINATE_PID_FILE" 2>/dev/null)" 2>/dev/null; then
            echo -e " Anti-Sleep Shield:     ${GREEN}ACTIVE${NC} (PID: $(cat "$CAFFEINATE_PID_FILE") - Mac lock protected)"
        else
            echo -e " Anti-Sleep Shield:     ${YELLOW}INACTIVE${NC}"
        fi
    fi
}

# ------------------------------------------------------------------------------
# Docker & Colima 4GB RAM / 4 CPU Verification
# ------------------------------------------------------------------------------
ensure_docker_and_resources() {
    echo -e "${BLUE}▶ Checking Docker runtime & resource limits...${NC}"

    # Check if Docker is responsive
    if ! docker info >/dev/null 2>&1; then
        echo -e " ${YELLOW}!${NC} Docker daemon is not responding."
        if command -v colima >/dev/null 2>&1; then
            echo -e " ${BLUE}ℹ Colima detected. Tuning config for ${TARGET_CPU} CPUs & ${TARGET_RAM_GB}GB RAM...${NC}"
            mkdir -p "$(dirname "$COLIMA_CONFIG")"
            if [[ -f "$COLIMA_CONFIG" ]]; then
                sed -i '' "s/^cpu:.*/cpu: $TARGET_CPU/" "$COLIMA_CONFIG" 2>/dev/null || true
                sed -i '' "s/^memory:.*/memory: $TARGET_RAM_GB/" "$COLIMA_CONFIG" 2>/dev/null || true
            else
                cat << EOF > "$COLIMA_CONFIG"
cpu: $TARGET_CPU
memory: $TARGET_RAM_GB
disk: 60
arch: host
runtime: docker
vmType: vz
EOF
            fi
            echo -e " ${BLUE}ℹ Starting Colima...${NC}"
            colima start
        else
            echo -e " ${RED}✖ Error: Docker is not running and Colima is not found.${NC}"
            echo -e "   Please start Docker Desktop or Colima and rerun this script."
            exit 1
        fi
    fi

    # Verify Allocated Memory and CPUs
    local mem_bytes ncpu mem_gb
    mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo "0")
    ncpu=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "0")
    mem_gb=$(awk "BEGIN {printf \"%.2f\", $mem_bytes/1073741824}")

    # Check if memory is under 3.5 GB (threshold for 4GB target)
    if [[ "$mem_bytes" -gt 0 && "$mem_bytes" -lt 3500000000 ]]; then
        echo -e " ${YELLOW}! Docker memory is currently ${mem_gb} GB (< ${TARGET_RAM_GB} GB target).${NC}"
        if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
            echo -e " ${BLUE}ℹ Updating Colima configuration to ${TARGET_RAM_GB}GB RAM & ${TARGET_CPU} CPUs...${NC}"
            mkdir -p "$(dirname "$COLIMA_CONFIG")"
            sed -i '' "s/^cpu:.*/cpu: $TARGET_CPU/" "$COLIMA_CONFIG" 2>/dev/null || true
            sed -i '' "s/^memory:.*/memory: $TARGET_RAM_GB/" "$COLIMA_CONFIG" 2>/dev/null || true
            echo -e " ${BLUE}ℹ Restarting Colima with upgraded allocation...${NC}"
            colima restart
            mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo "0")
            ncpu=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "0")
            mem_gb=$(awk "BEGIN {printf \"%.2f\", $mem_bytes/1073741824}")
        fi
    fi

    echo -e " ${GREEN}✓${NC} Docker Host Engine:    ${GREEN}ONLINE${NC} (${ncpu} CPUs, ${mem_gb} GB RAM)"
}

# ------------------------------------------------------------------------------
# Environment Setup & Lock Cleanup
# ------------------------------------------------------------------------------
setup_env() {
    if [[ ! -f "$PROJECT_DIR/.env" ]]; then
        if [[ -f "$PROJECT_DIR/.env.example" ]]; then
            echo -e " ${YELLOW}•${NC} Creating .env from .env.example..."
            cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        fi
    fi
}

cleanup_stale_locks() {
    if docker compose ps -q redis 2>/dev/null | grep -q .; then
        # Check and delete any orphaned scan running locks
        local stale_keys
        stale_keys=$(docker compose exec -T redis redis-cli --scan --pattern "scan:*:running_lock" 2>/dev/null || true)
        if [[ -n "$stale_keys" ]]; then
            echo -e " ${YELLOW}•${NC} Clearing stale scan locks from Redis..."
            echo "$stale_keys" | while read -r key; do
                if [[ -n "$key" ]]; then
                    docker compose exec -T redis redis-cli del "$key" >/dev/null 2>&1 || true
                fi
            done
        fi
    fi
}

# ------------------------------------------------------------------------------
# Service Lifecycle Commands
# ------------------------------------------------------------------------------
start_services() {
    print_banner
    ensure_docker_and_resources
    start_anti_sleep
    setup_env

    echo -e "\n${BLUE}▶ Starting MantisVision Swarm Containers...${NC}"
    docker compose up -d

    echo -e "\n${BLUE}▶ Verifying Service Health...${NC}"

    # Wait for PostgreSQL
    local retries=30
    printf "   • PostgreSQL Database:  "
    until docker compose exec -T postgres pg_isready -U mantis -d mantis_web >/dev/null 2>&1 || [[ $retries -eq 0 ]]; do
        sleep 1
        retries=$((retries - 1))
    done
    if [[ $retries -gt 0 ]]; then
        echo -e "${GREEN}READY${NC}"
    else
        echo -e "${RED}TIMEOUT${NC}"
    fi

    # Wait for Redis
    retries=15
    printf "   • Redis Broker/Cache:   "
    until docker compose exec -T redis redis-cli ping >/dev/null 2>&1 || [[ $retries -eq 0 ]]; do
        sleep 1
        retries=$((retries - 1))
    done
    if [[ $retries -gt 0 ]]; then
        echo -e "${GREEN}READY${NC}"
        cleanup_stale_locks
    else
        echo -e "${RED}TIMEOUT${NC}"
    fi

    # Wait for Backend API
    retries=30
    printf "   • Backend Swarm API:    "
    until curl -s -f http://localhost:8000/docs >/dev/null 2>&1 || [[ $retries -eq 0 ]]; do
        sleep 1
        retries=$((retries - 1))
    done
    if [[ $retries -gt 0 ]]; then
        echo -e "${GREEN}READY${NC}"
    else
        echo -e "${RED}TIMEOUT${NC}"
    fi

    # Wait for Celery Worker
    retries=20
    printf "   • Celery Worker Nodes:  "
    until docker compose exec -T worker celery -A app.pipeline.orchestrator.celery_app inspect ping >/dev/null 2>&1 || [[ $retries -eq 0 ]]; do
        sleep 1
        retries=$((retries - 1))
    done
    if [[ $retries -gt 0 ]]; then
        echo -e "${GREEN}READY${NC}"
    else
        echo -e "${YELLOW}STARTING (in background)${NC}"
    fi

    # Wait for Frontend
    retries=20
    printf "   • Web UI Frontend:      "
    until curl -s -f http://localhost:3000 >/dev/null 2>&1 || curl -s -f http://localhost >/dev/null 2>&1 || [[ $retries -eq 0 ]]; do
        sleep 1
        retries=$((retries - 1))
    done
    if [[ $retries -gt 0 ]]; then
        echo -e "${GREEN}READY${NC}"
    else
        echo -e "${YELLOW}STARTING (in background)${NC}"
    fi

    echo -e "\n${GREEN}${BOLD}======================================================================${NC}"
    echo -e " ${BOLD}🚀 MantisVision is LIVE and Ready for Security Audits!${NC}"
    echo -e "${GREEN}${BOLD}======================================================================${NC}"
    echo -e "  • ${BOLD}Web Application:${NC}      ${CYAN}http://localhost${NC}"
    echo -e "  • ${BOLD}FastAPI Backend Docs:${NC} ${CYAN}http://localhost:8000/docs${NC}"
    echo -e "  • ${BOLD}Swarm Tracing & Forensics:${NC} ${CYAN}Built-in Native Inspector (In-App)${NC}"
    echo -e "  • ${BOLD}Anti-Sleep Shield:${NC}    ${GREEN}ACTIVE${NC} (Safe to lock Mac without scan throttling)"
    echo -e "${GREEN}${BOLD}======================================================================${NC}"
    echo -e "  Manage commands: ${BLUE}./run.sh status${NC} | ${BLUE}./run.sh logs${NC} | ${BLUE}./run.sh stop${NC}\n"
}

stop_services() {
    print_banner
    echo -e "${BLUE}▶ Stopping MantisVision Swarm Containers...${NC}"
    docker compose down
    stop_anti_sleep
    echo -e " ${GREEN}✓${NC} All services stopped successfully.\n"
}

restart_services() {
    print_banner
    echo -e "${BLUE}▶ Restarting MantisVision Swarm...${NC}"
    docker compose down
    stop_anti_sleep
    sleep 1
    start_services
}

show_status() {
    print_banner
    echo -e "${BLUE}▶ System & Resource Status:${NC}"
    if docker info >/dev/null 2>&1; then
        local mem_bytes ncpu mem_gb
        mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo "0")
        ncpu=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "0")
        mem_gb=$(awk "BEGIN {printf \"%.2f\", $mem_bytes/1073741824}")
        echo -e " Docker Engine:         ${GREEN}ONLINE${NC} (${ncpu} CPUs, ${mem_gb} GB RAM)"
    else
        echo -e " Docker Engine:         ${RED}OFFLINE${NC}"
    fi
    check_anti_sleep

    echo -e "\n${BLUE}▶ Container Status:${NC}"
    docker compose ps

    echo -e "\n${BLUE}▶ Celery Worker Status:${NC}"
    if docker compose ps -q worker 2>/dev/null | grep -q .; then
        docker compose exec -T worker celery -A app.pipeline.orchestrator.celery_app inspect active 2>/dev/null || echo -e " ${YELLOW}Worker not responding${NC}"
    else
        echo -e " ${YELLOW}Worker container not running${NC}"
    fi
    echo ""
}

show_logs() {
    local service="${1:-}"
    if [[ -n "$service" ]]; then
        docker compose logs -f "$service"
    else
        docker compose logs -f
    fi
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
COMMAND="${1:-start}"

case "$COMMAND" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "${2:-}"
        ;;
    caffeinate)
        start_anti_sleep
        ;;
    decaffeinate)
        stop_anti_sleep
        ;;
    help|--help|-h)
        print_banner
        echo "Usage: ./run.sh [COMMAND]"
        echo ""
        echo "Commands:"
        echo "  start     (default) Start all services, verify 4GB RAM, and activate anti-sleep shield"
        echo "  stop      Stop all containers and release anti-sleep shield"
        echo "  restart   Restart all containers and re-verify system health"
        echo "  status    Show container states, Docker memory, worker tasks, and anti-sleep status"
        echo "  logs      Follow logs of all services (or ./run.sh logs <service>)"
        echo ""
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo "Run ./run.sh help for available commands."
        exit 1
        ;;
esac
