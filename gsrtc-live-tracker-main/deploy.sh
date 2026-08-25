#!/usr/bin/env bash
# ST Tracker — Oracle Cloud Deployment Script
# Run this ON THE SERVER after uploading the project.
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Prerequisites: Ubuntu 22.04+, project files in ~/st-tracker/

set -euo pipefail

DOMAIN="tracker.shivrajsinh.in"
APP_DIR="$HOME/st-tracker"
PORT=8787

# ── 0. Secrets ──────────────────────────────────────────────
# .env is gitignored on purpose, so it never arrives with the code. Without it the server
# exits immediately, and a pm2 restart loop is a miserable way to discover that.
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat <<MSG

  Missing $APP_DIR/.env

  The upstream credentials are deliberately not in the repository. Copy them up first:

      scp .env <user>@<server>:$APP_DIR/.env

  See .env.example for the shape of the file. Then re-run this script.

MSG
  exit 1
fi
chmod 600 "$APP_DIR/.env"

echo "============================================"
echo "  ST Tracker — Deployment"
echo "  Domain: $DOMAIN"
echo "============================================"

# ── 1. Install Node.js 22 LTS (ARM-compatible) ──────────────
# Needs >= 20.12 for process.loadEnvFile(), which is how the server reads .env.
NODE_MAJOR_MIN=20
if ! command -v node &>/dev/null; then
  echo "→ Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  CURRENT_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if (( CURRENT_MAJOR < NODE_MAJOR_MIN )); then
    echo "→ Node $(node -v) is too old; installing 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "→ Node.js already installed: $(node -v)"
  fi
fi

# ── 2. Install pm2 ──────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "→ Installing pm2..."
  sudo npm install -g pm2
else
  echo "→ pm2 already installed"
fi

# ── 3. Install project dependencies ─────────────────────────
echo "→ Installing npm dependencies..."
cd "$APP_DIR"
npm install --production

# ── 4. Start the app with pm2 ───────────────────────────────
echo "→ Starting ST Tracker with pm2..."
mkdir -p "$APP_DIR/.data"
pm2 delete st-tracker 2>/dev/null || true
# --cwd matters: the server resolves .env and its tracker state relative to the working
# directory, and pm2 does not inherit the shell's.
PORT=$PORT ALLOWED_ORIGINS="https://$DOMAIN" TRUST_PROXY=1 \
  pm2 start server/proxy.mjs --name st-tracker --cwd "$APP_DIR" --time
pm2 save

# Fail loudly here rather than leaving a restart loop to be discovered later.
sleep 2
if ! curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "✗ The app did not come up. Check: pm2 logs st-tracker --lines 50"
  exit 1
fi
echo "→ Health check passed ✓"

# Auto-start on reboot
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || echo "  (pm2 startup already configured)"

# ── 5. Install Nginx ────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  echo "→ Installing Nginx..."
  sudo apt-get update
  sudo apt-get install -y nginx
else
  echo "→ Nginx already installed"
fi

# ── 6. Configure Nginx reverse proxy ────────────────────────
echo "→ Configuring Nginx for $DOMAIN..."
# This box serves only ST Tracker, so claim default_server: without it nginx answers any
# request that does not match $DOMAIN — including plain requests to the IP, which is how you
# test before DNS exists — with its own welcome page instead of the app.
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/sites-available/st-tracker <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN _;

    # Security headers come from the app itself (see baseHeaders in server/proxy.mjs);
    # adding them here too would send each one twice.

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for slow upstream
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/st-tracker /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
echo "→ Nginx configured ✓"

# ── 7. Open firewall ports ──────────────────────────────────
echo "→ Opening firewall ports 80 and 443..."
# Oracle's Ubuntu image ships an INPUT chain that ends in a REJECT, so these have to be
# inserted at the top (-I INPUT 1) rather than appended, or they never match.
# Note the variable name: `PORT` is the app's port and reusing it here would clobber it for
# everything below.
for WEB_PORT in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$WEB_PORT" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$WEB_PORT" -j ACCEPT
  fi
done

# Persist iptables rules
if command -v netfilter-persistent &>/dev/null; then
  sudo netfilter-persistent save
else
  sudo apt-get install -y iptables-persistent
  sudo netfilter-persistent save
fi

# ── 8. SSL with Certbot ─────────────────────────────────────
if ! command -v certbot &>/dev/null; then
  echo "→ Installing Certbot..."
  sudo apt-get install -y certbot python3-certbot-nginx
fi

echo ""
echo "============================================"
echo "  ✅ App is running on port $PORT"
echo "============================================"
echo ""
echo "REMAINING STEPS (manual):"
echo ""
echo "1. ADD DNS RECORD IN CLOUDFLARE:"
echo "   Type: A"
echo "   Name: tracker"
echo "   Content: 130.210.21.111"
echo "   Proxy: OFF (grey cloud / DNS only)"
echo ""
echo "2. OPEN PORTS IN ORACLE CLOUD CONSOLE:"
echo "   → Networking → Virtual Cloud Networks → vcn-20260707-0227"
echo "   → Security Lists → Default Security List"
echo "   → Add Ingress Rules:"
echo "     Source CIDR: 0.0.0.0/0  |  Port: 80   |  TCP"
echo "     Source CIDR: 0.0.0.0/0  |  Port: 443  |  TCP"
echo ""
echo "3. AFTER DNS propagates (wait ~2 min), run:"
echo "   sudo certbot --nginx -d $DOMAIN"
echo ""
echo "4. TEST: https://$DOMAIN"
echo ""
