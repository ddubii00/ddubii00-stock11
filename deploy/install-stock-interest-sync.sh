#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./deploy/install-stock-interest-sync.sh <stock5-base-url>"
  exit 1
fi

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$REPO_ROOT/scripts/stock-interest-sync.py"
SERVICE_SOURCE="$REPO_ROOT/deploy/stock-interest-sync.service.example"
ENV_FILE="/etc/stock-interest-sync.env"

if [ ! -f "$SOURCE" ] || [ ! -f "$SERVICE_SOURCE" ]; then
  echo "Run this installer from the stock11 repository."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  STOCK5_BASE_URL=${1:-}
  if [ -z "$STOCK5_BASE_URL" ]; then
    echo "First install requires stock5 base URL."
    echo "Example:"
    echo "  sudo ./deploy/install-stock-interest-sync.sh https://HOST/stock5-8"
    exit 1
  fi

  umask 077
  cat > "$ENV_FILE" <<EOF
STOCK_INTEREST_SYNC_STOCK5_BASE_URL=$STOCK5_BASE_URL
STOCK_INTEREST_SYNC_STOCK11_ENV=/var/www/stock11-7/.env.oracle
STOCK_INTEREST_SYNC_STOCK11_BASE_PATH=/stock11-7
STOCK_INTEREST_SYNC_STOCK5_APP_DIR=/var/www/stock5-8
STOCK_INTEREST_SYNC_STATE_DIR=/var/lib/stock-interest-sync
STOCK_INTEREST_SYNC_BACKUP_DIR=/var/backups/stock-interest-sync
STOCK_INTEREST_SYNC_INTERVAL_SEC=3
STOCK_INTEREST_SYNC_MAX_STOCK5_ITEMS=100
STOCK_INTEREST_SYNC_VERIFY_TLS=false
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE"
else
  echo "Keeping existing $ENV_FILE"
fi

install -d -m 700 /var/lib/stock-interest-sync
install -d -m 700 /var/backups/stock-interest-sync
install -m 755 "$SOURCE" /usr/local/sbin/stock-interest-sync.py
install -m 644 "$SERVICE_SOURCE" /etc/systemd/system/stock-interest-sync.service

python3 -m py_compile /usr/local/sbin/stock-interest-sync.py

systemctl daemon-reload
systemctl enable stock-interest-sync.service
systemctl restart stock-interest-sync.service

sleep 5

echo
echo "Service:"
systemctl is-active stock-interest-sync.service

echo
echo "Recent log:"
journalctl -u stock-interest-sync.service -n 20 --no-pager

echo
echo "Check:"
set -a
. "$ENV_FILE"
set +a
/usr/bin/python3 /usr/local/sbin/stock-interest-sync.py --check
