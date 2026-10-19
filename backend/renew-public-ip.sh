#!/bin/sh
set -eu
exec 9>/run/star-orbit-certificate.lock
flock -n 9 || exit 0
docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /opt/xingke-acme/webroot:/var/www/acme \
  -v /opt/xingke-acme/work:/var/lib/letsencrypt \
  -v /opt/xingke-acme/logs:/var/log/letsencrypt \
  certbot/certbot:v5.5.0 renew --non-interactive --no-random-sleep-on-renew "$@"
docker exec xingke-v2-public-admin-proxy-1 nginx -t
docker exec xingke-v2-public-admin-proxy-1 nginx -s reload
