#!/usr/bin/env bash
# Install or update Jokoding Invoice on an Ubuntu/Debian VPS.
#
# Run it on the VPS, from the repository folder. Two ways:
#
#   sudo bash deploy/install.sh
#       No domain (for example behind ngrok). nginx listens on 127.0.0.1:8080 only,
#       then point the tunnel at it: ngrok http 8080
#       Other port: WEB_PORT=9000 sudo -E bash deploy/install.sh
#
#   sudo bash deploy/install.sh invoice.yourdomain.com
#       Own domain. nginx listens on port 80 and the script sets up HTTPS (Let's Encrypt).
#
# Re-run the same command after `git pull` to deploy an update.
# Invoice data in /var/lib/jokoding-invoice and the login are kept.
#
# API port: PORT=3200 sudo -E bash deploy/install.sh ...  (default 3100)
set -euo pipefail

DOMAIN="${1:-}"
PORT="${PORT:-3100}"
WEB_PORT="${WEB_PORT:-8080}"
APP_NAME="jokoding-invoice"
WEB_ROOT="/var/www/$APP_NAME"
APP_DIR="/opt/$APP_NAME"
DATA_FILE="/var/lib/$APP_NAME/invoices.json"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
NGINX_SITE="/etc/nginx/sites-available/invoice"
NGINX_LINK="/etc/nginx/sites-enabled/invoice"
HTPASSWD="/etc/nginx/.htpasswd-invoice"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_CMD="sudo bash deploy/install.sh${DOMAIN:+ $DOMAIN}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nError: %s\n' "$*" >&2; exit 1; }
ask_yes() { local answer; read -rp "$1 [y/N] " answer; [[ $answer =~ ^[Yy]$ ]]; }
# Name of the program listening on a TCP port, or nothing when the port is free.
port_owner() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2; }

# ---------- checks ----------

[[ $EUID -eq 0 ]] || die "run with sudo: $INSTALL_CMD"
[[ -z $DOMAIN || $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid domain: $DOMAIN"
[[ $PORT =~ ^[0-9]+$ ]] || die "invalid PORT: $PORT"
[[ $WEB_PORT =~ ^[0-9]+$ ]] || die "invalid WEB_PORT: $WEB_PORT"
[[ $PORT != "$WEB_PORT" ]] || die "PORT and WEB_PORT must be different"
command -v apt-get >/dev/null || die "this script supports Ubuntu/Debian (apt) only"
[[ -f $REPO_DIR/server/main.mjs && -f $REPO_DIR/index.html ]] || die "run from the invoice repository (server/main.mjs not found in $REPO_DIR)"

# Another program on the API port would break the API silently.
owner="$(port_owner "$PORT")"
if [[ -n $owner ]] && ! systemctl is-active --quiet "$APP_NAME"; then
  die "API port $PORT is already used by '$owner'. Pick another one: PORT=3200 sudo -E $INSTALL_CMD"
fi

if [[ -z $DOMAIN ]]; then
  owner="$(port_owner "$WEB_PORT")"
  if [[ -n $owner && $owner != nginx ]]; then
    die "port $WEB_PORT is already used by '$owner'. Stop it, or pick another one: WEB_PORT=9000 sudo -E $INSTALL_CMD"
  fi
else
  # Two nginx sites with the same domain: nginx would ignore one of them.
  for file in /etc/nginx/sites-enabled/*; do
    [[ -e $file && $(readlink -f "$file") != "$NGINX_SITE" ]] || continue
    if grep -qE "server_name[^;]*[[:space:]]${DOMAIN//./\\.}([[:space:];]|$)" "$file"; then
      die "$file already serves $DOMAIN. Remove that site (or rename it to $NGINX_SITE), then re-run."
    fi
  done
fi

# ---------- packages ----------

say "Installing packages (nginx, openssl, curl)"
apt-get update -qq
apt-get install -y -qq nginx openssl curl >/dev/null

node_major() { if command -v node >/dev/null; then node -p 'process.versions.node.split(".")[0]'; else echo 0; fi; }
if (( $(node_major) < 18 )); then
  echo "Node.js 18 or newer is required (found: $(command -v node >/dev/null && node --version || echo none))."
  ask_yes "Install Node.js 24 LTS from deb.nodesource.com?" || die "install Node.js 18+ yourself, then re-run"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"
# The service cannot see /root or /home (ProtectHome), so a Node from nvm there would fail.
[[ $NODE_BIN == /root/* || $NODE_BIN == /home/* ]] && die "node at $NODE_BIN is in a home folder. Install Node.js system-wide (apt), then re-run."
echo "Node.js $("$NODE_BIN" --version) at $NODE_BIN"

# ---------- files ----------

say "Copying web app to $WEB_ROOT"
install -d "$WEB_ROOT"
cp -r "$REPO_DIR/index.html" "$REPO_DIR/style.css" "$REPO_DIR/js" "$REPO_DIR/assets" "$WEB_ROOT/"

say "Copying API server to $APP_DIR"
install -d "$APP_DIR/server"
install -m 644 "$REPO_DIR"/server/*.mjs "$APP_DIR/server/"

# ---------- API service ----------

say "Starting service $APP_NAME on 127.0.0.1:$PORT"
sed -e "s|__NODE__|$NODE_BIN|" -e "s|__APP_DIR__|$APP_DIR|" -e "s|__PORT__|$PORT|" \
  "$REPO_DIR/deploy/$APP_NAME.service" > "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable --quiet "$APP_NAME"
systemctl restart "$APP_NAME"
for _ in $(seq 1 10); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 \
  || die "API is not answering. Check the log: journalctl -u $APP_NAME -n 50"
echo "API OK"

# ---------- login ----------

if [[ -s $HTPASSWD ]]; then
  say "Keeping the existing login in $HTPASSWD (delete that file and re-run to reset it)"
else
  say "Creating the login for the site"
  read -rp "Username [admin]: " AUTH_USER
  AUTH_USER="${AUTH_USER:-admin}"
  [[ $AUTH_USER != *:* ]] || die "username cannot contain ':'"
  while true; do
    read -rsp "Password: " PASS1; echo
    read -rsp "Repeat password: " PASS2; echo
    [[ -n $PASS1 && $PASS1 == "$PASS2" ]] && break
    echo "Passwords are empty or different. Try again."
  done
  printf '%s:%s\n' "$AUTH_USER" "$(printf '%s' "$PASS1" | openssl passwd -apr1 -stdin)" > "$HTPASSWD"
  unset PASS1 PASS2
  chown root:www-data "$HTPASSWD"
  chmod 640 "$HTPASSWD"
fi

# ---------- nginx ----------

BACKUP=""
if [[ -f $NGINX_SITE ]]; then
  BACKUP="$NGINX_SITE.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$NGINX_SITE" "$BACKUP"
fi
if [[ -z $DOMAIN ]]; then
  say "Configuring nginx on 127.0.0.1:$WEB_PORT (no domain)"
  # Localhost only: the tunnel (ngrok) on this VPS is the only way in.
  sed -e "s|^\([[:space:]]*\)listen 80;|\1listen 127.0.0.1:$WEB_PORT;|" \
      -e "/listen \[::\]:80;/d" \
      -e "s|server_name invoice\.example\.com;|server_name _;|" \
      -e "s|127\.0\.0\.1:3100|127.0.0.1:$PORT|" \
      "$REPO_DIR/deploy/nginx.conf" > "$NGINX_SITE"
else
  say "Configuring nginx for $DOMAIN"
  sed -e "s|invoice\.example\.com|$DOMAIN|g" -e "s|127\.0\.0\.1:3100|127.0.0.1:$PORT|" \
      "$REPO_DIR/deploy/nginx.conf" > "$NGINX_SITE"
fi
[[ -n $BACKUP ]] && echo "Old config saved as $BACKUP"
ln -sf "$NGINX_SITE" "$NGINX_LINK"
if ! nginx -t 2>/dev/null; then
  nginx -t || true
  if [[ -n $BACKUP ]]; then cp "$BACKUP" "$NGINX_SITE"; else rm -f "$NGINX_LINK"; fi
  die "nginx rejected the new config, so the old one was put back"
fi
systemctl reload nginx

# ---------- HTTPS (domain only; ngrok already gives HTTPS) ----------

if [[ -z $DOMAIN ]]; then
  OPEN_AT="your ngrok URL. Start the tunnel with: ngrok http $WEB_PORT"
# Writing the config above removed certbot's HTTPS lines; put them back when a certificate exists.
elif [[ -d /etc/letsencrypt/live/$DOMAIN ]]; then
  say "Re-applying the existing HTTPS certificate"
  command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --reinstall --redirect --non-interactive
  OPEN_AT="https://$DOMAIN"
elif ask_yes "Set up HTTPS with Let's Encrypt now? (the domain must already point to this VPS)"; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --redirect
  OPEN_AT="https://$DOMAIN"
else
  OPEN_AT="http://$DOMAIN"
  echo "Skipped. Without HTTPS the password travels unencrypted. Re-run this script later to add it."
fi

# ---------- done ----------

say "Done"
cat <<EOF
Open:     $OPEN_AT
Data:     $DATA_FILE (previous version: invoices.json.bak)
Logs:     journalctl -u $APP_NAME -f
Backup:   sudo cp $DATA_FILE ~/invoices-\$(date +%F).json
Update:   git pull && $INSTALL_CMD
EOF
