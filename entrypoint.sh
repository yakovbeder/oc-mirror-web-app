#!/bin/bash
set -e

APP_DATA="/app/data"
DIRS="$APP_DATA/configs $APP_DATA/operations $APP_DATA/logs $APP_DATA/cache $APP_DATA/mirrors/default"

for d in $DIRS; do
    mkdir -p "$d"
done

chown -R node:node "$APP_DATA"
chmod -R 775 "$APP_DATA"

if su -s /bin/sh node -c "test -w $APP_DATA/configs"; then
    echo "[ENTRYPOINT] Permissions OK"
else
    echo "[ENTRYPOINT] ERROR: $APP_DATA/configs not writable by node user"
    echo "[ENTRYPOINT] Host fix: sudo chown -R 1000:1000 data/ && sudo chmod -R 775 data/"
    exit 1
fi

exec runuser -u node -- "$@"
