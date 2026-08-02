#!/usr/bin/env bash
# Runs backend (:8080) and frontend (:5173) together. Ctrl-C stops both.
set -e
cd "$(dirname "$0")"

# backend
( cd backend && python -m uvicorn app.main:app --reload --port 8080 ) &
BACK=$!

# frontend
( cd frontend && npm run dev ) &
FRONT=$!

trap "kill $BACK $FRONT 2>/dev/null" EXIT
wait
