#!/usr/bin/env bash
# Safe Ubuntu deployment for 招生系统 CRM.
# Syncs code/build artifacts only. It never uploads crm.db, .env, venvs,
# node_modules, logs, screenshots, Playwright auth state, or other runtime data.
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-frp-end.com}"
REMOTE_PORT="${REMOTE_PORT:-30002}"
REMOTE_USER="${REMOTE_USER:-qingwei}"
REMOTE_DIR="${REMOTE_DIR:-/home/qingwei/crm}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/crm_server_id_ed25519}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_OPTS=(-i "$SSH_KEY" -p "$REMOTE_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

info() { printf '\033[0;32m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m[deploy:error]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY"
[[ -d "$ROOT/app" ]] || fail "app/ not found under $ROOT"
[[ -d "$ROOT/frontend/dist" ]] || fail "frontend/dist/ missing; run: cd frontend && npm run build"

info "preflight: sensitive files are excluded by design"
if git -C "$ROOT" ls-files | grep -E '(^|/)(crm\.db|\.env$|\.secret_key|node_modules|\.venv|tests/e2e/\.auth|screenshots/|.*\.log$|.*\.pid$)' >&2; then
  fail "tracked sensitive/runtime file detected; clean git index before deploy"
fi

info "remote backup of code only"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  cd '$REMOTE_DIR'
  STAMP=\$(date +%Y%m%d-%H%M%S)
  BACKUP=\$HOME/deploy-backups/crm-code-\$STAMP
  mkdir -p \$BACKUP
  cp -a app \$BACKUP/app
  cp -a frontend \$BACKUP/frontend
  cp -a requirements.txt \$BACKUP/requirements.txt
  cp -a logging.json \$BACKUP/logging.json
  echo \$BACKUP
"

info "sync app/"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$ROOT/app/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/app/"

info "sync frontend/dist/"
rsync -az --delete -e "$RSYNC_SSH" \
  "$ROOT/frontend/dist/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/frontend/dist/"

info "sync safe support files"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "mkdir -p /tmp/crm-upload-files '$REMOTE_DIR/data'"
rsync -az -e "$RSYNC_SSH" \
  "$ROOT/requirements.txt" \
  "$ROOT/logging.json" \
  "$ROOT/data/school_regions.json" \
  "$REMOTE_USER@$REMOTE_HOST:/tmp/crm-upload-files/"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  cp /tmp/crm-upload-files/requirements.txt '$REMOTE_DIR/requirements.txt'
  cp /tmp/crm-upload-files/logging.json '$REMOTE_DIR/logging.json'
  cp /tmp/crm-upload-files/school_regions.json '$REMOTE_DIR/data/school_regions.json'
  rm -rf /tmp/crm-upload-files
"

info "install Python deps"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  cd '$REMOTE_DIR'
  .venv-py312/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -r requirements.txt
"

info "restart service without sudo password: TERM current process and let systemd restart"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  OLD=\$(systemctl show -p MainPID --value crm.service)
  if [ -n \"\$OLD\" ] && [ \"\$OLD\" != 0 ]; then kill -TERM \"\$OLD\"; fi
  for i in \$(seq 1 30); do
    sleep 1
    NEW=\$(systemctl show -p MainPID --value crm.service)
    ACTIVE=\$(systemctl is-active crm.service || true)
    HEALTH=\$(curl -sS --max-time 2 http://127.0.0.1:8000/api/health 2>/dev/null || true)
    echo \"try=\$i active=\$ACTIVE pid=\$NEW health=\$HEALTH\"
    echo \"\$HEALTH\" | grep -q '\"code\":0' && break
    if [ \"\$i\" = 30 ]; then journalctl -u crm.service -n 80 --no-pager; exit 1; fi
  done
  systemctl is-active crm.service cloudflared-crm.service natfrp.service
  ls -lh '$REMOTE_DIR/crm.db' '$REMOTE_DIR/.env'
"

info "done"
