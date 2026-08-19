#!/usr/bin/env bash
# Idempotent repository bootstrap for the Tzudong Cloud Agent environment.
# Installs the pinned toolchain (Node 24, Bun, Docker engine + Compose v2.39.4)
# and web dependencies. Long-running daemons and the Supabase stack are started
# by start.sh, not here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib.sh"

COMPOSE_VERSION="v2.39.4"

log "install: ensuring Node 24 toolchain"
if ! tzudong_find_node24_bin >/dev/null 2>&1; then
  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    export NVM_DIR="${HOME}/.nvm"
    # shellcheck source=/dev/null
    . "${NVM_DIR}/nvm.sh"
    nvm install 24 >/dev/null
    nvm alias default 24 >/dev/null
  else
    log "install: nvm unavailable, installing Node 24 via NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - >/dev/null
    sudo apt-get install -y nodejs >/dev/null
  fi
fi

tzudong_activate_toolchain
log "install: node=$(node --version 2>/dev/null) npm=$(npm --version 2>/dev/null)"
corepack enable >/dev/null 2>&1 || true

log "install: ensuring Bun"
if ! command -v bun >/dev/null 2>&1 && [ ! -x "${HOME}/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash >/dev/null
fi
export PATH="${HOME}/.bun/bin:${PATH}"
log "install: bun=$(bun --version 2>/dev/null)"

log "install: ensuring Docker engine"
if ! command -v dockerd >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update >/dev/null
  sudo apt-get install -y \
    docker-ce docker-ce-cli containerd.io fuse-overlayfs uidmap >/dev/null
fi

log "install: pinning Docker Compose ${COMPOSE_VERSION}"
COMPOSE_PLUGIN="/usr/local/lib/docker/cli-plugins/docker-compose"
if [ "$(docker compose version --short 2>/dev/null || true)" != "${COMPOSE_VERSION#v}" ]; then
  sudo mkdir -p "$(dirname "${COMPOSE_PLUGIN}")"
  sudo curl -fsSL -o "${COMPOSE_PLUGIN}" \
    "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64"
  sudo chmod +x "${COMPOSE_PLUGIN}"
  # Remove any apt-provided plugin so the pinned version wins.
  sudo rm -f /usr/libexec/docker/cli-plugins/docker-compose 2>/dev/null || true
fi
log "install: compose=$(docker compose version --short 2>/dev/null)"

log "install: installing web dependencies (bun --frozen-lockfile)"
( cd "${TZUDONG_REPO_ROOT}/apps/web" && bun install --frozen-lockfile )

log "install: complete"
