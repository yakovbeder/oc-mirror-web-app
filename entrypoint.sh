#!/bin/bash
set -e

# Check and attempt to fix permissions for mounted volumes
# This ensures /app/data and /app/downloads are writable by the node user (UID 1000)
echo "[ENTRYPOINT] Checking permissions for mounted volumes..."

# Ensure directories exist
mkdir -p /app/data/configs /app/data/operations /app/data/logs /app/data/cache /app/downloads 2>/dev/null || true

# Try to make directories writable (best effort - may fail if owned by different user)
# First try group/world write permissions
chmod -R 775 /app/data /app/downloads 2>/dev/null || chmod -R 777 /app/data /app/downloads 2>/dev/null || true

# Check if we can write to the directories
if [ -w /app/data ] && [ -w /app/downloads ]; then
    echo "[ENTRYPOINT] Permissions OK - directories are writable"
else
    echo "[ENTRYPOINT] WARNING: Directories may not be writable"
    echo "[ENTRYPOINT] Ensure host directories are owned by UID 1000 or have world-writable permissions"
fi

echo "[ENTRYPOINT] Starting application..."
exec "$@"

