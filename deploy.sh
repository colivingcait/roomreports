#!/bin/bash
set -e

APP_DIR="/var/www/roomreport"
LOG_DIR="/var/log/roomreport"

cd "$APP_DIR"
# Record schema state BEFORE the pull so we can detect changes afterward.
SCHEMA_BEFORE="$(git rev-parse HEAD:prisma/schema.prisma 2>/dev/null || echo '')"

echo "==> Pulling latest code..."
# Ensure we're on main so the checkout can't drift onto a feature branch.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "   (switching from $CURRENT_BRANCH to main)"
  git fetch origin main
  git checkout main
fi
git pull --ff-only origin main

SCHEMA_AFTER="$(git rev-parse HEAD:prisma/schema.prisma)"

echo "==> Installing dependencies..."
npm ci

echo "==> Generating Prisma client..."
rm -rf server/node_modules/.prisma
npm run db:generate

# Auto-apply schema changes when schema.prisma changed in this pull.
# Additive changes (new columns, new enum values) apply cleanly. If `db push`
# would be destructive (dropped columns, etc.) it will prompt and `set -e`
# will halt the deploy — inspect and run manually before retrying.
if [ "$SCHEMA_BEFORE" != "$SCHEMA_AFTER" ]; then
  echo "==> prisma/schema.prisma changed — applying with prisma db push..."
  # By default prisma db push aborts on destructive changes. Additive changes
  # (new columns, new enum values) apply cleanly. If this step fails, inspect
  # the schema drift before re-running manually.
  npx prisma db push
else
  echo "==> Schema unchanged — skipping prisma db push."
fi

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
