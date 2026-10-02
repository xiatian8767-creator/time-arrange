#!/bin/sh
set -eu
cd /opt/xingke-v2
if [ ! -f .env ]; then
  umask 077
  python3 -c 'import secrets,pathlib; pathlib.Path(".env").write_text("DB_PASSWORD="+secrets.token_hex(32)+"\n")'
fi
docker compose -f compose.v2.yaml up -d --build
docker compose -f compose.v2.yaml ps
