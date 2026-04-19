# Nginx + SSL setup for RoomReport

Two Nginx sites run on the droplet (`68.183.111.240`):

| Host | Purpose |
|---|---|
| `app.roomreport.co` | Authenticated SPA (React client from `client/dist`) + `/api/*` proxy to Express on `:3001`. |
| `roomreport.co` / `www.roomreport.co` | Marketing site (`/var/www/roomreport-marketing`). Also serves the public resident routes (`/movein/*`, `/selfcheck/*`, `/join/*`) from the SPA and proxies `/api/*` to Express. |

## One-time install

1. Point DNS A records for `roomreport.co`, `www.roomreport.co`, and `app.roomreport.co` at `68.183.111.240`.
2. SSH into the droplet and make sure the repo is cloned at `/var/www/roomreport` and built (`npm install && npm run build`).
3. Run:
   ```bash
   sudo bash /var/www/roomreport/nginx/install.sh
   ```
4. After DNS has propagated, obtain certificates:
   ```bash
   sudo certbot --nginx -d roomreport.co -d www.roomreport.co -d app.roomreport.co
   ```
   Certbot updates both site files to listen on 443 and sets up auto-renew via the `certbot.timer` systemd unit.
5. Ensure the Express server is running on port 3001 via PM2:
   ```bash
   pm2 list
   pm2 restart roomreport-api
   ```

## Environment

In the server's `.env`:
```
APP_URL=https://app.roomreport.co
PUBLIC_URL=https://roomreport.co
USE_SECURE_COOKIES=true
```

## Updating configs later

Re-run `install.sh` — it copies the latest configs from the repo, tests Nginx, and reloads.
Certbot's TLS modifications on the files in `sites-available/` are preserved only if you run
certbot again after `install.sh` overwrites them. If you change a config, the safer order is:

```bash
sudo cp nginx/app.roomreport.co.conf /etc/nginx/sites-available/app.roomreport.co
sudo certbot --nginx -d app.roomreport.co   # re-applies the 443 block
sudo nginx -t && sudo systemctl reload nginx
```
