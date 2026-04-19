#!/usr/bin/env bash
# Install Nginx + Certbot and configure RoomReport.
# Run on the DigitalOcean droplet (68.183.111.240) as root:
#   bash /var/www/roomreport/nginx/install.sh
set -euo pipefail

REPO_DIR="/var/www/roomreport"
NGINX_DIR="$REPO_DIR/nginx"
MARKETING_DIR="/var/www/roomreport-marketing"

echo "==> Installing Nginx + Certbot"
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Ensuring marketing placeholder exists"
mkdir -p "$MARKETING_DIR"
if [ ! -f "$MARKETING_DIR/index.html" ]; then
    cat > "$MARKETING_DIR/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>RoomReport</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #0f172a; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { max-width: 520px; text-align: center; padding: 32px; }
    h1 { font-size: 2rem; margin-bottom: 8px; }
    p { color: #94a3b8; line-height: 1.6; }
    a { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>RoomReport</h1>
    <p>Property inspections for coliving operators.</p>
    <p><a href="https://app.roomreport.co">Sign in to the app →</a></p>
  </div>
</body>
</html>
HTML
fi

echo "==> Copying Nginx site configs"
cp "$NGINX_DIR/app.roomreport.co.conf" /etc/nginx/sites-available/app.roomreport.co
cp "$NGINX_DIR/roomreport.co.conf"     /etc/nginx/sites-available/roomreport.co

echo "==> Enabling sites"
ln -sf /etc/nginx/sites-available/app.roomreport.co /etc/nginx/sites-enabled/app.roomreport.co
ln -sf /etc/nginx/sites-available/roomreport.co     /etc/nginx/sites-enabled/roomreport.co
rm -f /etc/nginx/sites-enabled/default

echo "==> Testing Nginx config"
nginx -t

echo "==> Reloading Nginx"
systemctl reload nginx

echo
echo "==> Nginx is configured. Next steps:"
echo "   1. Point DNS A records for roomreport.co, www.roomreport.co, and app.roomreport.co"
echo "      at 68.183.111.240. Wait for propagation (dig +short app.roomreport.co)."
echo "   2. Obtain SSL certificates:"
echo "      certbot --nginx -d roomreport.co -d www.roomreport.co -d app.roomreport.co"
echo "   3. Ensure PM2 is running the Express server on port 3001:"
echo "      pm2 list"
echo "      pm2 restart roomreport-api || pm2 start server/src/index.js --name roomreport-api"
echo "   4. Confirm .env has:"
echo "      APP_URL=https://app.roomreport.co"
echo "      PUBLIC_URL=https://roomreport.co"
echo "      USE_SECURE_COOKIES=true"
echo
echo "Done."
