#!/bin/bash
cd "$(dirname "$0")/backend"
[ ! -d node_modules ] && npm install --no-audit --no-fund
[ ! -f .env ] && cp .env.example .env
exec npm start
