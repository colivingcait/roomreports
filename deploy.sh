#!/bin/bash
set -e

APP_DIR="/var/www/roomreport"
LOG_DIR="/var/log/roomreport"

echo "==> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo "==> Installing dependencies..."
npm ci

echo "==> Generating Prisma client..."
npm run db:generate

echo "==> Running migrations..."
npm run db:migrate

echo "==> Building client..."
npm run build

echo "==> Restarting server..."
pm2 restart roomreport --update-env || pm2 start server/src/index.js \
  --name roomreport \
  --cwd "$APP_DIR" \
  --log "$LOG_DIR/app.log" \
  --time

pm2 save

echo "==> Deploy complete!"
