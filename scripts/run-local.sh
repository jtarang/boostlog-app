#!/usr/bin/env bash
#
# run-local.sh — Launch boostLog locally WITHOUT Docker.
#
# Uses the SQLite fallback DB and skips the AWS Secrets fetch, so no Postgres,
# Ollama, or cloud dependencies are needed. Binds to 0.0.0.0 so you can open the
# app on your phone over the same Wi-Fi (great for testing mobile layout).
#
# Usage:
#   ./scripts/run-local.sh            # http://localhost:8000  (+ LAN URL printed)
#   PORT=9000 ./scripts/run-local.sh  # custom port
#   ./scripts/run-local.sh --reload   # auto-reload on code changes (dev)
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts) and run from there,
# since the app reads static/ and ./data via relative paths.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8000}"
VENV="$ROOT/venv"

# --- venv: create + install deps on first run -------------------------------
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "› Creating virtualenv at venv/ ..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  echo "› Installing dependencies (first run only) ..."
  "$VENV/bin/pip" install --quiet -r requirements.txt
fi
PY="$VENV/bin/python"

# --- local-only environment -------------------------------------------------
export SKIP_AWS_FETCH=true                                   # no AWS Secrets call
export DATABASE_URL="${DATABASE_URL:-sqlite:///./data/boostlog.db}"
export SECRET_KEY="${SECRET_KEY:-local_dev_secret_key}"
export ALLOWED_HOSTS="${ALLOWED_HOSTS:-*}"                   # accept LAN hostnames

# --- figure out the LAN IP so you can open it on a phone --------------------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"

echo ""
echo "  boostLog running without Docker (SQLite, no AWS)"
echo "  ──────────────────────────────────────────────"
echo "  Desktop : http://localhost:$PORT/app"
if [[ -n "$LAN_IP" ]]; then
  echo "  Phone   : http://$LAN_IP:$PORT/app   (same Wi-Fi)"
else
  echo "  Phone   : (could not detect LAN IP — check System Settings › Network)"
fi
echo "  Login   : demo / demo"
echo "  Tip     : on your phone, hard-refresh to bypass cached CSS"
echo "  ──────────────────────────────────────────────"
echo ""

exec "$PY" -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT" "$@"
