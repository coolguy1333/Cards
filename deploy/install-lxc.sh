#!/usr/bin/env bash
# Install/update ClassCards inside a Debian 12 / Ubuntu 24.04 LXC (run as root from the repo folder).
set -euo pipefail
APP_DIR=/opt/classcards
DATA_DIR=/var/lib/classcards
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo ">> Installing Node.js 22"
  apt-get update && apt-get install -y curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y build-essential python3 >/dev/null  # only needed if better-sqlite3 has no prebuilt binary

id classcards >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin classcards
mkdir -p "$APP_DIR" "$DATA_DIR"

echo ">> Copying app to $APP_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "$SRC_DIR"/ "$APP_DIR"/ 2>/dev/null \
  || { apt-get install -y rsync && rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "$SRC_DIR"/ "$APP_DIR"/; }

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" "$APP_DIR/.env"
  echo ">> Created $APP_DIR/.env — edit BASE_URL, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then: systemctl restart classcards"
fi

cd "$APP_DIR" && npm ci --omit=dev 2>/dev/null || npm install --omit=dev
chown -R classcards:classcards "$DATA_DIR"
chown root:classcards "$APP_DIR/.env" && chmod 640 "$APP_DIR/.env"

cp "$APP_DIR/deploy/classcards.service" /etc/systemd/system/classcards.service
systemctl daemon-reload
systemctl enable --now classcards
systemctl restart classcards
echo ">> Done. Status: systemctl status classcards   Logs: journalctl -u classcards -f"
