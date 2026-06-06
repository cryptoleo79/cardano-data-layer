#!/usr/bin/env bash
# Go-live for api.asy.life. Run on the server (194.36.144.105) as a sudo-capable
# user, AFTER the DNS A/AAAA record for api.asy.life points here.
#   bash deploy/deploy.sh
# It uses sudo for nginx + certbot only. The Node app already runs under
# user-systemd (cardano-data-layer.service, linger enabled) on 127.0.0.1:8787.
set -euo pipefail

DOMAIN=api.asy.life
EMAIL=chris@ashiyaradio.co.jp
SVC_DIR=/home/midnight/cardano-data-layer/service
APP_USER=midnight

echo "==> 1. App service health (user-systemd on 127.0.0.1:8787)"
curl -fsS http://127.0.0.1:8787/health >/dev/null && echo "   app OK" || {
  echo "   app not responding — starting it:"
  sudo -u "$APP_USER" XDG_RUNTIME_DIR=/run/user/$(id -u "$APP_USER") systemctl --user enable --now cardano-data-layer.service
  sleep 2; curl -fsS http://127.0.0.1:8787/health >/dev/null && echo "   app OK" || { echo "   FAILED"; exit 1; }
}

echo "==> 2. Install nginx vhost"
sudo cp "$SVC_DIR/deploy/api.asy.life.nginx.conf" /etc/nginx/sites-available/$DOMAIN
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
sudo nginx -t
sudo systemctl reload nginx
echo "   nginx reloaded"

echo "==> 3. TLS via certbot (HTTP-01; needs DNS already pointing here)"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "==> Done. Verify:"
echo "   curl https://$DOMAIN/health"
echo "   curl https://$DOMAIN/openapi.json | head"
echo "   open  https://$DOMAIN/docs"
