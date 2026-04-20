#!/bin/bash
set -e

APP_DIR="/var/www/roomreport"
LOG_DIR="/var/log/roomreport"

echo "==> Pulling latest code..."
cd "$APP_DIR"
# Ensure we're on main so the checkout can't drift onto a feature branch.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "   (switching from $CURRENT_BRANCH to main)"
  git fetch origin main
  git checkout main
fi
git pull --ff-only origin main

echo "==> Installing dependencies..."
npm ci

echo "==> Generating Prisma client..."
rm -rf server/node_modules/.prisma
npm run db:generate

# Database schema changes are applied manually via `npx prisma db push`
# when the schema.prisma file changes. Skipped here to avoid drift prompts.

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
