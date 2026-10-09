#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Necesitas instalar Node.js 20 o superior: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install || exit 1
PORT="${PORT:-3000}"
( sleep 1; (command -v open >/dev/null && open "http://127.0.0.1:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://127.0.0.1:$PORT") ) >/dev/null 2>&1 &
exec node server.js
