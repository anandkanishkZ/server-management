#!/usr/bin/env bash
#
# Server Panel - one-line installer for a fresh Ubuntu VPS (22.04 / 24.04).
#
#   curl -fsSL https://raw.githubusercontent.com/anandkanishkZ/server-management/main/install.sh | sudo bash
#
# What this does:
#   - Installs Node.js, PostgreSQL, Nginx, PM2 and build tools
#   - Creates an unprivileged "panel" system user (no sudo rights at all -
#     every privileged action goes through a separate root-owned helper
#     daemon with a strict action whitelist)
#   - Clones this repo to /opt/panel, builds it, and wires up systemd
#     services for the API and the helper
#   - Serves the panel over plain HTTP on port 80 (add a domain + SSL later
#     from the Domains & SSL page, or see deploy/nginx-panel.conf)
#   - Prints a generated admin login at the end
#
# This script is meant for a vanilla box with nothing else on port 80/nginx
# yet. Read it before piping it into a root shell, same as you would for any
# other install script.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

REPO_URL="${REPO_URL:-https://github.com/anandkanishkZ/server-management.git}"
INSTALL_DIR="/opt/panel"
PANEL_USER="panel"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@panel.local}"
NODE_MAJOR="20"

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$1"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run this as root (or with sudo)."

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  warn "This installer targets Ubuntu 22.04/24.04. Continuing anyway, but things may not match."
fi

FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
if [ "${FREE_MB:-0}" -lt 2000 ]; then
  warn "Less than 2GB free on / (${FREE_MB}MB). The install may run out of disk space."
fi

ORIGINAL_USER="${SUDO_USER:-}"
SYSTEM_LOGIN_USERS=""
if [ -n "$ORIGINAL_USER" ] && [ "$ORIGINAL_USER" != "root" ]; then
  SYSTEM_LOGIN_USERS="$ORIGINAL_USER"
fi

log "Installing system packages (this can take a few minutes)"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git build-essential python3 \
  nginx postgresql postgresql-contrib ufw openssl certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2"
  npm install -g pm2
fi

log "Ensuring the panel system user exists"
if ! id -u "$PANEL_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$PANEL_USER"
fi
# Needed to read Nginx's logs (root:adm 640 by default) from the Logs page.
usermod -aG adm "$PANEL_USER"
# Root for the File Manager's "Hosted Apps" view and where deployed apps live.
mkdir -p "/home/$PANEL_USER/app"
chown "$PANEL_USER:$PANEL_USER" "/home/$PANEL_USER/app"

log "Starting PostgreSQL"
systemctl enable --now postgresql

log "Fetching the panel source"
# This directory ends up owned by $PANEL_USER (see chown further down), so a
# re-run - which does this step as root - trips git's "dubious ownership"
# check without this.
git config --global --add safe.directory "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
elif [ -e "$INSTALL_DIR" ]; then
  fail "$INSTALL_DIR already exists and isn't a git checkout of this repo. Move it aside and re-run."
else
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

ENV_FILE="$INSTALL_DIR/apps/api/.env"
if [ -f "$ENV_FILE" ]; then
  log "Reusing existing apps/api/.env"
  DBA_PASSWORD=$(grep '^DBA_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
else
  log "Generating secrets"
  DBA_PASSWORD=$(openssl rand -hex 20)
  JWT_SECRET=$(openssl rand -hex 32)
fi

log "Configuring the panel's PostgreSQL role and database"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panel_dba') THEN
    CREATE ROLE panel_dba WITH LOGIN SUPERUSER PASSWORD '${DBA_PASSWORD}';
  ELSE
    ALTER ROLE panel_dba WITH PASSWORD '${DBA_PASSWORD}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='panel'" | grep -q 1 \
  || sudo -u postgres createdb -O panel_dba panel

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://panel_dba:${DBA_PASSWORD}@127.0.0.1:5432/panel
JWT_SECRET=${JWT_SECRET}
COOKIE_SECURE=false
PORT=4000
HOST=127.0.0.1
DBA_HOST=127.0.0.1
DBA_PORT=5432
DBA_USER=panel_dba
DBA_PASSWORD=${DBA_PASSWORD}
PANEL_OS_USER=${PANEL_USER}
HELPER_SOCKET_PATH=/run/panel/helper.sock
SYSTEM_LOGIN_USERS=${SYSTEM_LOGIN_USERS}
EOF
  chmod 600 "$ENV_FILE"
fi

log "Installing dependencies (npm workspaces)"
(cd "$INSTALL_DIR" && npm install)

log "Syncing the database schema"
(cd "$INSTALL_DIR/apps/api" && npx prisma db push)

log "Building the API, web app and helper"
(cd "$INSTALL_DIR" && npm run build --workspace apps/api)
(cd "$INSTALL_DIR" && npm run build --workspace apps/web)
(cd "$INSTALL_DIR" && npm run build --workspace helper)

MARKER="$INSTALL_DIR/.admin-seeded"
ADMIN_SEEDED_NOW=false
if [ ! -f "$MARKER" ]; then
  log "Creating the initial admin account"
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-20)
  (cd "$INSTALL_DIR/apps/api" && node dist/scripts/createAdmin.js "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  touch "$MARKER"
  ADMIN_SEEDED_NOW=true
fi

log "Setting file ownership"
chown -R "$PANEL_USER:$PANEL_USER" "$INSTALL_DIR"

log "Installing systemd services"
cp "$INSTALL_DIR/deploy/panel-helper.service" /etc/systemd/system/panel-helper.service
cp "$INSTALL_DIR/deploy/panel-api.service" /etc/systemd/system/panel-api.service
systemctl daemon-reload
systemctl enable panel-helper panel-api
# restart (not just start) so re-running this script after a fix actually
# picks up unit file / build changes on a box that's already running.
systemctl restart panel-helper
sleep 1
systemctl restart panel-api

log "Configuring Nginx"
NGINX_CONF=/etc/nginx/sites-available/panel
cat > "$NGINX_CONF" <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root INSTALL_DIR_PLACEHOLDER/apps/web/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sed -i "s#INSTALL_DIR_PLACEHOLDER#$INSTALL_DIR#" "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/panel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "Allowing SSH/HTTP/HTTPS through UFW (firewall left disabled - enable it from the Security page when ready)"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

log "Enabling PM2 startup for the panel user (for apps you deploy later)"
su - "$PANEL_USER" -c "pm2 startup" > /tmp/panel-pm2-startup.log 2>&1 || true
STARTUP_CMD=$(grep -Eo 'sudo .*pm2 .*startup.*' /tmp/panel-pm2-startup.log | tail -1 || true)
[ -n "$STARTUP_CMD" ] && eval "$STARTUP_CMD" >/dev/null 2>&1 || true

PUBLIC_IP=$(curl -fs -4 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

printf '\n\033[1;32m================================================================\033[0m\n'
printf '\033[1;32m  Server Panel is up\033[0m\n'
printf '\033[1;32m================================================================\033[0m\n'
printf '  URL:      http://%s/\n' "${PUBLIC_IP:-<this-servers-ip>}"
if [ "$ADMIN_SEEDED_NOW" = true ]; then
  printf '  Email:    %s\n' "$ADMIN_EMAIL"
  printf '  Password: %s\n' "$ADMIN_PASSWORD"
  printf '\n  Save that password now - it is only shown this once.\n'
else
  printf '  Admin account already existed from a previous install run.\n'
  printf '  Reset it with:\n'
  printf '    cd %s/apps/api && node dist/scripts/createAdmin.js %s <newpassword>\n' "$INSTALL_DIR" "$ADMIN_EMAIL"
fi
if [ -n "$SYSTEM_LOGIN_USERS" ]; then
  printf "\n  You can also sign in with your Linux account (%s) if it has a\n" "$SYSTEM_LOGIN_USERS"
  printf '  password set (sudo passwd %s) - the panel verifies it against sshd.\n' "$SYSTEM_LOGIN_USERS"
fi
printf '\n  Next steps from inside the panel:\n'
printf '    - Add a domain + SSL from Domains & SSL\n'
printf '    - Enable the firewall from Security once your allow rules look right\n'
printf '\033[1;32m================================================================\033[0m\n\n'
