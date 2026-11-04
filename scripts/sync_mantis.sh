#!/usr/bin/env bash
# ==============================================================================
# Google Mantis Upstream Synchronizer
# ==============================================================================
# Synchronizes official Google Mantis (google/mantis) skills, tree-sitter
# structural index, and staging environments directly into NewGenSAST.
#
# Usage:
#   ./scripts/sync_mantis.sh [BRANCH_OR_TAG]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UPSTREAM_REPO="https://github.com/google/mantis.git"
REF="${1:-main}"
CLONE_DIR="/tmp/google_mantis_sync"

echo "=========================================================="
echo " Google Mantis Upstream Sync"
echo " Upstream: ${UPSTREAM_REPO} (${REF})"
echo " Target:   ${PROJECT_ROOT}"
echo "=========================================================="

# 1. Clone or pull upstream
if [ -d "${CLONE_DIR}/.git" ]; then
    echo "[+] Updating existing clone in ${CLONE_DIR}..."
    git -C "${CLONE_DIR}" fetch --all --prune
    git -C "${CLONE_DIR}" checkout "${REF}"
    git -C "${CLONE_DIR}" pull origin "${REF}"
else
    echo "[+] Cloning ${UPSTREAM_REPO} into ${CLONE_DIR}..."
    rm -rf "${CLONE_DIR}"
    git clone --depth 1 --branch "${REF}" "${UPSTREAM_REPO}" "${CLONE_DIR}"
fi

COMMIT_HASH="$(git -C "${CLONE_DIR}" rev-parse HEAD)"
echo "[+] Upstream commit: ${COMMIT_HASH}"

# 2. Sync Official Modular Skills
echo "[+] Syncing upstream skills (skills/ -> backend/skills/)..."
mkdir -p "${PROJECT_ROOT}/backend/skills"

SKILL_COUNT=0
for skill_dir in "${CLONE_DIR}"/skills/*; do
    if [ -d "${skill_dir}" ]; then
        skill_name="$(basename "${skill_dir}")"
        target_dir="${PROJECT_ROOT}/backend/skills/${skill_name}"
        mkdir -p "${target_dir}"
        cp -R "${skill_dir}/"* "${target_dir}/"
        SKILL_COUNT=$((SKILL_COUNT + 1))
    fi
done
echo "[+] Successfully synchronized ${SKILL_COUNT} official Google Mantis skills."

# 3. Sync Deterministic Tree-Sitter Structural Index
echo "[+] Syncing structural index core..."
MANTIS_PKG="${PROJECT_ROOT}/backend/app/pipeline/mantis"
mkdir -p "${MANTIS_PKG}"

# Sync structural_index.py (preserving package-relative import for staging)
if [ -f "${CLONE_DIR}/reference/core/structural_index.py" ]; then
    sed 's/from core.environments.staging import get_vetted_staging_files/from .staging import get_vetted_staging_files/g' \
        "${CLONE_DIR}/reference/core/structural_index.py" > "${MANTIS_PKG}/structural_index.py"
    echo "[+] Updated ${MANTIS_PKG}/structural_index.py"
fi

# Sync staging.py
if [ -f "${CLONE_DIR}/reference/core/environments/staging.py" ]; then
    sed -e 's/from core.environments.static_env import PROTECTED_METADATA_FILES, PROTECTED_VCS_DIRS/PROTECTED_VCS_DIRS = {".git", ".hg", ".svn", ".jj"}\nPROTECTED_METADATA_FILES = {".gitconfig", ".gitmodules", ".gitattributes", ".git-credentials", ".netrc", ".env", ".env.local", ".npmrc", ".pypirc", ".pre-commit-config.yaml"}/g' \
        -e 's/from .static_env import PROTECTED_METADATA_FILES, PROTECTED_VCS_DIRS/PROTECTED_VCS_DIRS = {".git", ".hg", ".svn", ".jj"}\nPROTECTED_METADATA_FILES = {".gitconfig", ".gitmodules", ".gitattributes", ".git-credentials", ".netrc", ".env", ".env.local", ".npmrc", ".pypirc", ".pre-commit-config.yaml"}/g' \
        "${CLONE_DIR}/reference/core/environments/staging.py" > "${MANTIS_PKG}/staging.py"
    echo "[+] Updated ${MANTIS_PKG}/staging.py"
fi

echo "=========================================================="
echo " Upstream sync complete!"
echo " Synced: ${SKILL_COUNT} skills and Tree-Sitter structural engine"
echo " Commit: ${COMMIT_HASH}"
echo "=========================================================="
