#!/usr/bin/env bash
# Controlled Ubuntu deployment for the admissions CRM.
# Uploads an immutable release, snapshots the live SQLite database, switches
# app/frontend paths to versioned releases, and rolls code back on failure.
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-frp-end.com}"
REMOTE_PORT="${REMOTE_PORT:-30002}"
REMOTE_USER="${REMOTE_USER:-qingwei}"
REMOTE_DIR="${REMOTE_DIR:-/home/qingwei/crm}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/crm_server_id_ed25519}"
KNOWN_HOSTS_FILE="${KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
SOURCE_ROOT="${SOURCE_ROOT:-}"
EXPECTED_DB_BASE_REVISION="${EXPECTED_DB_BASE_REVISION:-20260714_01}"
EXPECTED_DB_REVISION="${EXPECTED_DB_REVISION:-20260726_01}"
EXPECTED_DB_PATH="${EXPECTED_DB_PATH:-$REMOTE_DIR/crm.db}"
MAX_DEPLOY_BACKUPS="${MAX_DEPLOY_BACKUPS:-20}"
PREPARE_ONLY="${PREPARE_ONLY:-0}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://frp-end.com:22735}"
PUBLIC_CURL_INSECURE="${PUBLIC_CURL_INSECURE:-1}"
PUBLIC_PINNED_PUBKEY="${PUBLIC_PINNED_PUBKEY:-sha256//mn8PXhDLej6ELYJcxROMSkc1iV6PvaMA3q+epSmmDoc=}"
ALLOW_PUBLIC_HTTP_FOR_TESTS="${ALLOW_PUBLIC_HTTP_FOR_TESTS:-0}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_OPTS=(
  -i "$SSH_KEY"
  -p "$REMOTE_PORT"
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE"
)
RSYNC_SSH="ssh"
for option in "${SSH_OPTS[@]}"; do
  printf -v quoted_option '%q' "$option"
  RSYNC_SSH+=" $quoted_option"
done

LOCK_ACQUIRED=0
SWITCH_STARTED=0
DEPLOY_SUCCEEDED=0
REMOTE_CODE_BACKUP=""
REMOTE_DB_BACKUP=""
LIVE_DB_SOURCE=""
REMOTE_RELEASE=""
REMOTE_INCOMING=""
REMOTE_LOCK=""
REMOTE_RELEASE_CREATED=0
REMOTE_INCOMING_CREATED=0
OWNER_REPAIR_APPLIED=0
DATABASE_MIGRATION_ATTEMPTED=0

REMOTE_RESTART_HELPERS="$(cat <<'EOF'
verify_signal_restart_guard() {
  TARGET_PID="$1"
  ACTIVE_STATE=$(systemctl is-active crm.service 2>/dev/null || true)
  if [ "$ACTIVE_STATE" != active ]; then
    echo "refusing signal restart: crm.service is not active" >&2
    return 1
  fi

  RESTART_POLICY=$(systemctl show -p Restart --value crm.service 2>/dev/null || true)
  if [ "$RESTART_POLICY" != always ]; then
    echo "refusing signal restart: crm.service Restart policy is not always" >&2
    return 1
  fi

  case "$TARGET_PID" in
    ''|*[!0-9]*|0|1)
      echo "refusing signal restart: invalid MainPID '$TARGET_PID'" >&2
      return 1
      ;;
  esac

  CURRENT_PID=$(systemctl show -p MainPID --value crm.service 2>/dev/null || true)
  if [ "$CURRENT_PID" != "$TARGET_PID" ]; then
    echo "refusing signal restart: MainPID changed from '$TARGET_PID' to '$CURRENT_PID'" >&2
    return 1
  fi

  DEPLOY_USER=$(id -un)
  PID_OWNER=$(ps -o user= -p "$TARGET_PID" 2>/dev/null | awk '{$1=$1; print}')
  if [ -z "$PID_OWNER" ] || [ "$PID_OWNER" != "$DEPLOY_USER" ]; then
    echo "refusing signal restart: MainPID owner '$PID_OWNER' is not deployment user '$DEPLOY_USER'" >&2
    return 1
  fi

  CGROUP_PATHS=$(cat "/proc/$TARGET_PID/cgroup" 2>/dev/null | cut -d: -f3- || true)
  if ! printf '%s\n' "$CGROUP_PATHS" | grep -Fxq '/system.slice/crm.service'; then
    echo "refusing signal restart: MainPID is not in /system.slice/crm.service" >&2
    return 1
  fi

  if ! kill -0 "$TARGET_PID" 2>/dev/null; then
    echo "refusing signal restart: MainPID cannot be signalled" >&2
    return 1
  fi
}

guarded_signal_restart() {
  TARGET_PID="$1"
  verify_signal_restart_guard "$TARGET_PID" || return 1
  echo "using guarded SIGTERM restart for crm.service MainPID=$TARGET_PID"
  kill -TERM "$TARGET_PID"
}
EOF
)"

info() { printf '\033[0;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[deploy:warn]\033[0m %s\n' "$*" >&2; }
fail() {
  printf '\033[0;31m[deploy:error]\033[0m %s\n' "$*" >&2
  if [[ "${LOCK_ACQUIRED:-0}" == 1 || "${SWITCH_STARTED:-0}" == 1 ]]; then
    rollback_deploy 1 "$*"
  fi
  exit 1
}

release_lock() {
  if [[ "$LOCK_ACQUIRED" == 1 ]]; then
    ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" \
      "rm -rf '$REMOTE_LOCK'" >/dev/null 2>&1 || true
    LOCK_ACQUIRED=0
  fi
}

restart_and_wait() {
  local expected_frontend="$1"
  local database_helper="$2"
  local expected_database="$3"
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
    $REMOTE_RESTART_HELPERS
    cd '$REMOTE_DIR'
    OLD=\$(systemctl show -p MainPID --value crm.service)
    if systemctl --no-ask-password reset-failed crm.service >/dev/null 2>&1 && \
       systemctl --no-ask-password restart crm.service >/dev/null 2>&1; then
      SERVICE_CONTROL=direct
    elif sudo -n systemctl reset-failed crm.service >/dev/null 2>&1 && \
         sudo -n systemctl restart crm.service >/dev/null 2>&1; then
      SERVICE_CONTROL=sudo
    else
      guarded_signal_restart \"\$OLD\"
      SERVICE_CONTROL=signal
    fi
    echo \"restart_control=\$SERVICE_CONTROL old_pid=\$OLD\"
    if [ -z \"\$OLD\" ]; then OLD=0; fi

    HEALTHY=0
    NEW=0
    SEEN_NEW=0
    for i in \$(seq 1 30); do
      sleep 1
      NEW=\$(systemctl show -p MainPID --value crm.service)
      ACTIVE=\$(systemctl is-active crm.service || true)
      HEALTH=\$(curl -sS --max-time 2 http://127.0.0.1:8000/api/health 2>/dev/null || true)
      echo \"try=\$i active=\$ACTIVE pid=\$NEW health=\$HEALTH\"
      if [ -n \"\$NEW\" ] && [ \"\$NEW\" != 0 ] && [ \"\$NEW\" != \"\$OLD\" ]; then
        if [ \"\$SEEN_NEW\" = 0 ]; then
          SEEN_NEW=\$NEW
        elif [ \"\$NEW\" != \"\$SEEN_NEW\" ]; then
          echo 'new service process restarted before becoming healthy' >&2
          exit 1
        fi
      fi
      if [ \"\$ACTIVE\" = active ] && [ \"\$NEW\" = \"\$SEEN_NEW\" ] && [ \"\$NEW\" != 0 ] && \\
         echo \"\$HEALTH\" | grep -q '\"code\":0' && \\
         echo \"\$HEALTH\" | grep -q '\"db\":\"ok\"'; then
        HEALTHY=1
        break
      fi
    done
    if [ \"\$HEALTHY\" != 1 ]; then
      journalctl -u crm.service -n 80 --no-pager
      exit 1
    fi

    sleep 2
    STABLE_PID=\$(systemctl show -p MainPID --value crm.service)
    STABLE_ACTIVE=\$(systemctl is-active crm.service || true)
    STABLE_HEALTH=\$(curl -sS --max-time 3 http://127.0.0.1:8000/api/health 2>/dev/null || true)
    echo \"stable active=\$STABLE_ACTIVE pid=\$STABLE_PID health=\$STABLE_HEALTH\"
    if [ \"\$STABLE_ACTIVE\" != active ] || [ \"\$STABLE_PID\" != \"\$NEW\" ] || \\
       ! echo \"\$STABLE_HEALTH\" | grep -q '\"code\":0' || \\
       ! echo \"\$STABLE_HEALTH\" | grep -q '\"db\":\"ok\"'; then
      journalctl -u crm.service -n 80 --no-pager
      exit 1
    fi

    NEW_DB_SOURCE=\$('$REMOTE_DIR/.venv-py312/bin/python' '$database_helper' \\
      --process-id \"\$STABLE_PID\" \\
      --expect-working-directory '$REMOTE_DIR' \\
      --print-source)
    test \"\$NEW_DB_SOURCE\" = '$expected_database'

    INDEX_TMP=\$(mktemp)
    VERIFY_DIR=\$(mktemp -d)
    ASSET_LIST=\$(mktemp)
    trap 'rm -f \$INDEX_TMP \$ASSET_LIST; rm -rf \$VERIFY_DIR' EXIT
    curl -fsS --max-time 5 http://127.0.0.1:8000/ -o \$INDEX_TMP
    cmp -s \$INDEX_TMP '$expected_frontend/index.html'
    find '$expected_frontend' -type f ! -path '$expected_frontend/index.html' | sort > \$ASSET_LIST
    test -s \$ASSET_LIST
    ASSET_COUNT=0
    while IFS= read -r ASSET_FILE; do
      RELATIVE_FILE=\${ASSET_FILE#'$expected_frontend'/}
      SERVED_FILE=\$VERIFY_DIR/served-file
      rm -f \$SERVED_FILE
      curl -fsS --max-time 10 http://127.0.0.1:8000/\$RELATIVE_FILE -o \$SERVED_FILE
      if ! cmp -s \$SERVED_FILE \$ASSET_FILE; then
        echo served_frontend_file_mismatch:\$RELATIVE_FILE >&2
        exit 1
      fi
      ASSET_COUNT=\$((ASSET_COUNT + 1))
    done < \$ASSET_LIST
    echo verified_frontend_files=\$ASSET_COUNT
    systemctl is-active crm.service
    systemctl is-active cloudflared-crm.service natfrp.service || true
  "
}

verify_public_frontend() {
  local expected_frontend="$1"
  local verify_dir index_tmp asset_list health
  local asset_file relative_file served_file asset_count=0
  local curl_args=(-fsS --max-time 20 --pinnedpubkey "$PUBLIC_PINNED_PUBKEY")
  if [[ "$PUBLIC_CURL_INSECURE" == 1 ]]; then
    curl_args+=(--insecure)
  fi

  verify_dir="$(mktemp -d)"
  index_tmp="$verify_dir/index.html"
  asset_list="$verify_dir/assets.list"
  if ! curl "${curl_args[@]}" "$PUBLIC_BASE_URL/?release=$RELEASE_ID" -o "$index_tmp"; then
    rm -rf "$verify_dir"
    return 1
  fi
  if ! cmp -s "$index_tmp" "$expected_frontend/index.html"; then
    warn "public index does not match release $RELEASE_ID"
    rm -rf "$verify_dir"
    return 1
  fi

  find "$expected_frontend" -type f ! -path "$expected_frontend/index.html" | sort >"$asset_list"
  while IFS= read -r asset_file; do
    relative_file="${asset_file#"$expected_frontend"/}"
    served_file="$verify_dir/served-file"
    rm -f "$served_file"
    if ! curl "${curl_args[@]}" "$PUBLIC_BASE_URL/$relative_file" -o "$served_file"; then
      rm -rf "$verify_dir"
      return 1
    fi
    if ! cmp -s "$served_file" "$asset_file"; then
      warn "public frontend file mismatch: $relative_file"
      rm -rf "$verify_dir"
      return 1
    fi
    asset_count=$((asset_count + 1))
  done <"$asset_list"

  health="$(curl "${curl_args[@]}" "$PUBLIC_BASE_URL/api/health" || true)"
  if ! grep -q '"code":0' <<<"$health" || ! grep -q '"db":"ok"' <<<"$health"; then
    warn "public health verification failed: $health"
    rm -rf "$verify_dir"
    return 1
  fi
  rm -rf "$verify_dir"
  info "public frontend verified: files=$asset_count health=ok"
}

verify_remote_public_frontend() {
  local remote_frontend="$1"
  local snapshot_dir status=0
  snapshot_dir="$(mktemp -d)"
  if ! rsync -az --delete --no-perms --no-owner --no-group -e "$RSYNC_SSH" \
    "$REMOTE_USER@$REMOTE_HOST:$remote_frontend/" "$snapshot_dir/"; then
    rm -rf "$snapshot_dir"
    return 1
  fi
  verify_public_frontend "$snapshot_dir" || status=$?
  rm -rf "$snapshot_dir"
  return "$status"
}

rollback_deploy() {
  local status="$1"
  local reason="$2"
  trap - ERR INT TERM HUP
  warn "deployment aborted: $reason"

  if [[ "$SWITCH_STARTED" == 1 && "$DEPLOY_SUCCEEDED" == 0 && -n "$REMOTE_CODE_BACKUP" ]]; then
    warn "atomically restoring the previous release pointer from $REMOTE_CODE_BACKUP"
    if ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
      cd '$REMOTE_DIR'
      test -d '$REMOTE_CODE_BACKUP/app'
      test -d '$REMOTE_CODE_BACKUP/frontend/dist'
      ln -s '$REMOTE_CODE_BACKUP' '.deploy/current-rollback-$RELEASE_ID'
      mv -Tf '.deploy/current-rollback-$RELEASE_ID' '.deploy/current'
      ln -s '$REMOTE_DEPLOY_ROOT/current/app' '.deploy/app-stable-rollback-$RELEASE_ID'
      if [ -L app ] || [ ! -e app ]; then
        mv -Tf '.deploy/app-stable-rollback-$RELEASE_ID' app
      else
        mv app '$REMOTE_CODE_BACKUP/interrupted-app'
        mv -Tf '.deploy/app-stable-rollback-$RELEASE_ID' app
      fi
      ln -s '$REMOTE_DEPLOY_ROOT/current/frontend/dist' '.deploy/dist-stable-rollback-$RELEASE_ID'
      if [ -L frontend/dist ] || [ ! -e frontend/dist ]; then
        mv -Tf '.deploy/dist-stable-rollback-$RELEASE_ID' frontend/dist
      else
        mv frontend/dist '$REMOTE_CODE_BACKUP/interrupted-dist'
        mv -Tf '.deploy/dist-stable-rollback-$RELEASE_ID' frontend/dist
      fi
      if [ -f '$REMOTE_CODE_BACKUP/release-manifest.json' ]; then
        cp '$REMOTE_CODE_BACKUP/release-manifest.json' '.deploy/manifest.rollback'
        mv -f '.deploy/manifest.rollback' release-manifest.json
      else
        rm -f release-manifest.json
      fi
    "; then
      if restart_and_wait \
        "$REMOTE_CODE_BACKUP/frontend/dist" \
        "$REMOTE_RELEASE/scripts/sqlite_online_backup.py" \
        "$LIVE_DB_SOURCE"; then
        if verify_remote_public_frontend "$REMOTE_CODE_BACKUP/frontend/dist"; then
          warn "code rollback completed; internal service and public frontend recovered"
        else
          warn "code rollback restored internal service, but public frontend recovery could not be verified"
        fi
      else
        warn "code paths were restored, but service health did not recover"
      fi
    else
      warn "automatic code rollback failed; restore manually from $REMOTE_CODE_BACKUP"
    fi
  elif [[ "$SWITCH_STARTED" == 0 ]]; then
    if [[ "$REMOTE_INCOMING_CREATED" == 1 ]]; then
      ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" \
        "if [ -e '$REMOTE_INCOMING' ]; then chmod -R u+w '$REMOTE_INCOMING'; rm -rf '$REMOTE_INCOMING'; fi" \
        >/dev/null 2>&1 || true
    fi
    if [[ "$REMOTE_RELEASE_CREATED" == 1 ]]; then
      ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" \
        "if [ -e '$REMOTE_RELEASE' ]; then chmod -R u+w '$REMOTE_RELEASE'; rm -rf '$REMOTE_RELEASE'; fi" \
        >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "$REMOTE_DB_BACKUP" ]]; then
    warn "database snapshot retained at $REMOTE_DB_BACKUP; it was not restored automatically"
  fi
  if [[ "$DATABASE_MIGRATION_ATTEMPTED" == 1 ]]; then
    warn "database migration was attempted and may be retained; inspect the live revision before retrying"
  fi
  if [[ "$OWNER_REPAIR_APPLIED" == 1 ]]; then
    warn "work-item owner repair was committed and was not reversed with the code rollback"
  fi
  release_lock
  exit "$status"
}

on_error() {
  local status=$?
  rollback_deploy "$status" "command failed with exit code $status"
}

on_signal() {
  local signal="$1"
  local status=1
  case "$signal" in
    INT) status=130 ;;
    TERM) status=143 ;;
    HUP) status=129 ;;
  esac
  rollback_deploy "$status" "received $signal"
}

trap on_error ERR
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP

[[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY"
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$REMOTE_DIR" != "/" ]] || fail "unsafe REMOTE_DIR: $REMOTE_DIR"
[[ ! "$REMOTE_DIR" =~ (^|/)\.\.?(/|$) && "$REMOTE_DIR" != *//* ]] || fail "REMOTE_DIR contains unsafe path segments"
[[ "$EXPECTED_DB_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "unsafe EXPECTED_DB_PATH: $EXPECTED_DB_PATH"
[[ ! "$EXPECTED_DB_PATH" =~ (^|/)\.\.?(/|$) && "$EXPECTED_DB_PATH" != *//* ]] || fail \
  "EXPECTED_DB_PATH contains unsafe path segments"
[[ "$EXPECTED_DB_BASE_REVISION" =~ ^[A-Za-z0-9_]+$ ]] || fail \
  "invalid EXPECTED_DB_BASE_REVISION: $EXPECTED_DB_BASE_REVISION"
[[ "$EXPECTED_DB_REVISION" =~ ^[A-Za-z0-9_]+$ ]] || fail \
  "invalid EXPECTED_DB_REVISION: $EXPECTED_DB_REVISION"
[[ "$MAX_DEPLOY_BACKUPS" =~ ^[1-9][0-9]*$ ]] || fail "MAX_DEPLOY_BACKUPS must be a positive integer"
[[ "$PUBLIC_CURL_INSECURE" == 0 || "$PUBLIC_CURL_INSECURE" == 1 ]] || fail \
  "PUBLIC_CURL_INSECURE must be 0 or 1"
[[ "$PUBLIC_PINNED_PUBKEY" =~ ^sha256//[A-Za-z0-9+/]{43}=$ ]] || fail \
  "PUBLIC_PINNED_PUBKEY must be a sha256// SPKI pin"
[[ "$PUBLIC_BASE_URL" =~ ^https?://[A-Za-z0-9._:-]+(/[A-Za-z0-9._~/-]*)?$ ]] || fail \
  "unsafe PUBLIC_BASE_URL: $PUBLIC_BASE_URL"
[[ "$ALLOW_PUBLIC_HTTP_FOR_TESTS" == 0 || "$ALLOW_PUBLIC_HTTP_FOR_TESTS" == 1 ]] || fail \
  "ALLOW_PUBLIC_HTTP_FOR_TESTS must be 0 or 1"
if [[ "$PUBLIC_BASE_URL" == http://* ]]; then
  [[ "$ALLOW_PUBLIC_HTTP_FOR_TESTS" == 1 && "$PUBLIC_BASE_URL" == "http://fake-public" ]] || fail \
    "PUBLIC_BASE_URL must use https; plain HTTP is allowed only for the isolated fake-public simulation"
fi
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
[[ -n "$SOURCE_ROOT" ]] || fail \
  "SOURCE_ROOT is required; run scripts/prepare-production-release.ps1 and point SOURCE_ROOT at its output"
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

info "verify exact prepared release file set and checksums"
python3 "$ROOT/scripts/verify_production_release.py" "$SOURCE_ROOT"

MANIFEST_DB_REVISION="$(
  sed -n 's/.*"expected_database_revision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$SOURCE_ROOT/release-manifest.json" | head -n 1
)"
MANIFEST_DB_BASE_REVISION="$(
  sed -n 's/.*"database_upgrade_from_revision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$SOURCE_ROOT/release-manifest.json" | head -n 1
)"
RELEASE_ID="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$SOURCE_ROOT/release-manifest.json" | head -n 1
)"
[[ -n "$RELEASE_ID" && "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid release version in manifest"
[[ "$MANIFEST_DB_REVISION" == "$EXPECTED_DB_REVISION" ]] || fail \
  "release expects database revision $MANIFEST_DB_REVISION, configured $EXPECTED_DB_REVISION"
[[ "$MANIFEST_DB_BASE_REVISION" == "$EXPECTED_DB_BASE_REVISION" ]] || fail \
  "release upgrades from database revision $MANIFEST_DB_BASE_REVISION, configured $EXPECTED_DB_BASE_REVISION"
[[ "$EXPECTED_DB_BASE_REVISION" != "$EXPECTED_DB_REVISION" ]] || fail \
  "database upgrade start and target revisions must differ"

info "release=$RELEASE_ID source=$SOURCE_ROOT database_revision=$EXPECTED_DB_BASE_REVISION->$EXPECTED_DB_REVISION"
if [[ "$PREPARE_ONLY" == 1 ]]; then
  info "prepared release verification complete; no remote connection was made"
  exit 0
fi

REMOTE_DEPLOY_ROOT="$REMOTE_DIR/.deploy"
REMOTE_RELEASE="$REMOTE_DEPLOY_ROOT/releases/$RELEASE_ID"
REMOTE_INCOMING="$REMOTE_DEPLOY_ROOT/.incoming-$RELEASE_ID"
REMOTE_LOCK="$REMOTE_DEPLOY_ROOT/deploy.lock"

info "acquire remote deployment lock and verify canonical runtime path"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  CANONICAL=\$(cd '$REMOTE_DIR' && pwd -P)
  test \"\$CANONICAL\" = '$REMOTE_DIR'
  test -f '$REMOTE_DIR/.env'
  test -x '$REMOTE_DIR/.venv-py312/bin/python'
  test -f '$REMOTE_DIR/app/main.py'
  test -f '$REMOTE_DIR/frontend/dist/index.html'
  mkdir -p '$REMOTE_DEPLOY_ROOT/releases'
  mkdir '$REMOTE_LOCK'
  printf '%s\\n' '$RELEASE_ID' > '$REMOTE_LOCK/release'
"
LOCK_ACQUIRED=1

info "upload release into an isolated remote directory"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  test ! -e '$REMOTE_RELEASE'
  if [ -e '$REMOTE_INCOMING' ]; then
    chmod -R u+w '$REMOTE_INCOMING'
    rm -rf '$REMOTE_INCOMING'
  fi
  mkdir -p '$REMOTE_INCOMING'
"
REMOTE_INCOMING_CREATED=1
rsync -az --delete --no-perms --no-owner --no-group -e "$RSYNC_SSH" \
  "$SOURCE_ROOT/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_INCOMING/"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  cleanup_failed_release() {
    if [ -e '$REMOTE_RELEASE' ]; then
      chmod -R u+w '$REMOTE_RELEASE' 2>/dev/null || true
      rm -rf '$REMOTE_RELEASE'
    fi
  }
  trap cleanup_failed_release ERR
  find '$REMOTE_INCOMING' -type d -exec chmod 755 {} +
  find '$REMOTE_INCOMING' -type f -exec chmod 644 {} +
  '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_INCOMING/scripts/verify_production_release.py' '$REMOTE_INCOMING'
  mv '$REMOTE_INCOMING' '$REMOTE_RELEASE'
  find '$REMOTE_RELEASE' -type f -exec chmod 444 {} +
  find '$REMOTE_RELEASE' -type d -exec chmod 555 {} +
  trap - ERR
"
REMOTE_INCOMING_CREATED=0
REMOTE_RELEASE_CREATED=1

info "verify runtime boundaries, database identity, and backup capacity"
if ! RUNTIME_OUTPUT="$(ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  $REMOTE_RESTART_HELPERS
  cd '$REMOTE_DIR'
  CANDIDATE_REQUIREMENTS_HASH=\$(sed 's/\r$//' '$REMOTE_RELEASE/requirements.txt' | sha256sum | awk '{print \$1}')
  LIVE_REQUIREMENTS_HASH=\$(sed 's/\r$//' requirements.txt | sha256sum | awk '{print \$1}')
  [ "\$CANDIDATE_REQUIREMENTS_HASH" = "\$LIVE_REQUIREMENTS_HASH" ] || {
    echo 'requirements.txt changed; use a versioned virtual-environment rollout' >&2
    exit 1
  }
  CHANGED_GUARDS=
  for file in app/config.py app/database.py app/domain_models.py app/legacy_schema_compat.py \
              app/main.py app/migration_config.py app/models.py; do
    if ! cmp -s '$REMOTE_RELEASE/'\"\$file\" \"\$file\"; then
      CHANGED_GUARDS=\"\${CHANGED_GUARDS} \$file\"
    fi
  done
  cmp -s '$REMOTE_RELEASE/logging.json' logging.json || {
    echo 'logging.json changed; deploy it separately from the code release' >&2
    exit 1
  }
  cmp -s '$REMOTE_RELEASE/data/school_regions.json' data/school_regions.json || {
    echo 'school_regions.json changed; deploy it separately from the code release' >&2
    exit 1
  }
  POLICY=\$(systemctl show -p Restart --value crm.service)
  MAIN_PID=\$(systemctl show -p MainPID --value crm.service)
  if systemctl --no-ask-password reset-failed crm.service >/dev/null 2>&1; then
    SERVICE_CONTROL=direct
  elif sudo -n systemctl reset-failed crm.service >/dev/null 2>&1; then
    SERVICE_CONTROL=sudo
  else
    verify_signal_restart_guard \"\$MAIN_PID\"
    SERVICE_CONTROL=signal
  fi
  systemctl is-active crm.service
  test -n \"\$MAIN_PID\"
  test \"\$MAIN_PID\" != 0
  test -r \"/proc/\$MAIN_PID/environ\"
  echo \"restart_policy=\$POLICY service_control=\$SERVICE_CONTROL main_pid=\$MAIN_PID\"
  '$REMOTE_DIR/.venv-py312/bin/python' -c 'import alembic; print(\"python_runtime=ok alembic=\" + alembic.__version__)'
  CANDIDATE_HEAD=\$(
    cd '$REMOTE_RELEASE'
    '$REMOTE_DIR/.venv-py312/bin/python' -m alembic -c alembic.ini heads | awk 'NR == 1 {print \$1}'
  )
  test \"\$CANDIDATE_HEAD\" = '$EXPECTED_DB_REVISION'
  echo \"candidate_alembic_head=\$CANDIDATE_HEAD schema_guard_changes=\${CHANGED_GUARDS:-none}\"
  DB_SOURCE=\$('$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/sqlite_online_backup.py' \\
    --process-id \"\$MAIN_PID\" \\
    --expect-working-directory '$REMOTE_DIR' \\
    --print-source)
  EXPECTED_DB=\$(readlink -f '$EXPECTED_DB_PATH')
  test -n \"\$EXPECTED_DB\"
  test \"\$DB_SOURCE\" = \"\$EXPECTED_DB\"
  DB_REVISION=\$('$REMOTE_DIR/.venv-py312/bin/python' \
    '$REMOTE_RELEASE/scripts/sqlite_online_backup.py' \
    --source \"\$DB_SOURCE\" \
    --print-revision)
  case \"\$DB_REVISION\" in
    '$EXPECTED_DB_BASE_REVISION'|'$EXPECTED_DB_REVISION') ;;
    *)
      echo \"unsupported live database revision: \${DB_REVISION:-unversioned}\" >&2
      exit 1
      ;;
  esac
  '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/sqlite_online_backup.py' \
    --source \"\$DB_SOURCE\" \
    --expect-revision \"\$DB_REVISION\" \
    --inspect
  case \"\$DB_SOURCE\" in
    '$REMOTE_DIR/app'|'$REMOTE_DIR/app/'*|'$REMOTE_DIR/frontend'|'$REMOTE_DIR/frontend/'*|\
    '$REMOTE_DEPLOY_ROOT'|'$REMOTE_DEPLOY_ROOT/'*)
      echo \"database path is inside a switched release tree: \$DB_SOURCE\" >&2
      exit 1
      ;;
  esac
  CODE_KB=\$(du -skL app frontend/dist | awk '{total += \$1} END {print total + 0}')
  DB_KB=\$(du -k \"\$DB_SOURCE\" | awk '{print \$1}')
  AVAILABLE_KB=\$(df -Pk '$REMOTE_DIR' | awk 'NR == 2 {print \$4}')
  REQUIRED_KB=\$((CODE_KB + DB_KB + 102400))
  if [ \"\$AVAILABLE_KB\" -le \"\$REQUIRED_KB\" ]; then
    echo \"insufficient disk space: available=\$AVAILABLE_KB required=\$REQUIRED_KB KiB\" >&2
    exit 1
  fi
  BACKUP_COUNT=\$(find \"\$HOME/deploy-backups\" -maxdepth 1 -type f -name 'crm-db-*.db' 2>/dev/null | wc -l)
  if [ \"\$BACKUP_COUNT\" -ge '$MAX_DEPLOY_BACKUPS' ]; then
    echo \"deployment backup limit reached: \$BACKUP_COUNT (max $MAX_DEPLOY_BACKUPS); prune reviewed backups first\" >&2
    exit 1
  fi
  echo \"disk_available_kib=\$AVAILABLE_KB disk_required_kib=\$REQUIRED_KB\"
  printf '__CRM_RUNTIME__|%s|%s|%s\\n' \"\$DB_SOURCE\" \"\$MAIN_PID\" \"\$DB_REVISION\"
")"; then
  fail "remote runtime boundary verification failed"
fi
printf '%s\n' "$RUNTIME_OUTPUT"
RUNTIME_MARKER="$(printf '%s\n' "$RUNTIME_OUTPUT" | tail -n 1)"
IFS='|' read -r runtime_marker LIVE_DB_SOURCE LIVE_MAIN_PID LIVE_DB_REVISION <<< "$RUNTIME_MARKER"
[[ "$runtime_marker" == "__CRM_RUNTIME__" ]] || fail "could not parse remote runtime identity"
[[ "$LIVE_DB_SOURCE" == "$EXPECTED_DB_PATH" ]] || fail "running database path does not match EXPECTED_DB_PATH"
[[ "$LIVE_DB_REVISION" == "$EXPECTED_DB_BASE_REVISION" || \
   "$LIVE_DB_REVISION" == "$EXPECTED_DB_REVISION" ]] || fail \
  "running database revision is outside the supported rollout range"

info "audit work-item owner projections without modifying the live database"
if OWNER_PLAN_OUTPUT="$(ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "
  '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/repair_work_item_owners.py' \\
    --database '$LIVE_DB_SOURCE' \\
    --expect-revision '$LIVE_DB_REVISION'
")"; then
  OWNER_PLAN_STATUS=0
else
  OWNER_PLAN_STATUS=$?
fi
printf '%s\n' "$OWNER_PLAN_OUTPUT"
if [[ "$OWNER_PLAN_STATUS" != 0 && "$OWNER_PLAN_STATUS" != 1 ]]; then
  fail "work-item owner projection audit failed"
fi

info "create remote code backup and consistent snapshot of the running database"
if ! BACKUP_OUTPUT="$(ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  umask 077
  cd '$REMOTE_DIR'
  STAMP=\$(date +%Y%m%d-%H%M%S)
  BASE=\$HOME/deploy-backups
  CODE=\$BASE/crm-code-\$STAMP-$RELEASE_ID
  DB=\$BASE/crm-db-\$STAMP-$RELEASE_ID.db
  mkdir -p -m 700 \"\$BASE\" \"\$CODE/frontend\" \"\$CODE/data\"
  cp -aL app \"\$CODE/app\"
  cp -aL frontend/dist \"\$CODE/frontend/dist\"
  cp requirements.txt \"\$CODE/requirements.txt\"
  cp logging.json \"\$CODE/logging.json\"
  cp data/school_regions.json \"\$CODE/data/school_regions.json\"
  if [ -f release-manifest.json ]; then cp release-manifest.json \"\$CODE/release-manifest.json\"; fi
  '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/sqlite_online_backup.py' \\
    --source '$LIVE_DB_SOURCE' \\
    --destination \"\$DB\" \\
    --expect-revision '$LIVE_DB_REVISION'
  chmod -R go-rwx \"\$CODE\"
  chmod 600 \"\$DB\"
  printf '__CRM_BACKUPS__|%s|%s\\n' \"\$CODE\" \"\$DB\"
")"; then
  fail "remote code or database backup failed"
fi
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_MARKER="$(printf '%s\n' "$BACKUP_OUTPUT" | tail -n 1)"
IFS='|' read -r marker REMOTE_CODE_BACKUP REMOTE_DB_BACKUP <<< "$BACKUP_MARKER"
[[ "$marker" == "__CRM_BACKUPS__" ]] || fail "could not parse remote backup paths"
[[ "$REMOTE_CODE_BACKUP" == */deploy-backups/crm-code-* ]] || fail "unsafe code backup path"
[[ "$REMOTE_DB_BACKUP" == */deploy-backups/crm-db-*.db ]] || fail "unsafe database backup path"

if [[ "$LIVE_DB_REVISION" == "$EXPECTED_DB_BASE_REVISION" ]]; then
  info "upgrade production database from $EXPECTED_DB_BASE_REVISION to $EXPECTED_DB_REVISION"
  DATABASE_MIGRATION_ATTEMPTED=1
  if ! MIGRATION_OUTPUT="$(ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
    cd '$REMOTE_RELEASE'
    timeout 120s env -u DATABASE_URL PYTHONDONTWRITEBYTECODE=1 DATABASE_PATH='$LIVE_DB_SOURCE' SECRET_KEY='deployment-migration-only' APP_ENV=development '$REMOTE_DIR/.venv-py312/bin/python' -m alembic -c alembic.ini upgrade '$EXPECTED_DB_REVISION'
    '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/sqlite_online_backup.py' --source '$LIVE_DB_SOURCE' --expect-revision '$EXPECTED_DB_REVISION' --inspect
  ")"; then
    fail "database migration failed; code was not switched"
  fi
  printf '%s\n' "$MIGRATION_OUTPUT"
else
  info "database is already at $EXPECTED_DB_REVISION; migration is not required"
fi
LIVE_DB_REVISION="$EXPECTED_DB_REVISION"

info "repair work-item owners after the database snapshot and before the code switch"
if ! OWNER_REPAIR_OUTPUT="$(ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "
  '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/repair_work_item_owners.py' \\
    --database '$LIVE_DB_SOURCE' \\
    --expect-revision '$EXPECTED_DB_REVISION' \\
    --apply
")"; then
  fail "work-item owner repair failed"
fi
OWNER_REPAIR_APPLIED=1
printf '%s\n' "$OWNER_REPAIR_OUTPUT"

SWITCH_STARTED=1
info "bootstrap stable paths, then atomically switch the single current release pointer"
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  cd '$REMOTE_DIR'
  ln -s '$REMOTE_CODE_BACKUP' '.deploy/current-bootstrap-$RELEASE_ID'
  mv -Tf '.deploy/current-bootstrap-$RELEASE_ID' '.deploy/current'

  ln -s '$REMOTE_DEPLOY_ROOT/current/app' '.deploy/app-stable-$RELEASE_ID'
  if [ -L app ] || [ ! -e app ]; then
    mv -Tf '.deploy/app-stable-$RELEASE_ID' app
  else
    mv app '$REMOTE_CODE_BACKUP/original-app'
    mv -Tf '.deploy/app-stable-$RELEASE_ID' app
  fi

  ln -s '$REMOTE_DEPLOY_ROOT/current/frontend/dist' '.deploy/dist-stable-$RELEASE_ID'
  if [ -L frontend/dist ] || [ ! -e frontend/dist ]; then
    mv -Tf '.deploy/dist-stable-$RELEASE_ID' frontend/dist
  else
    mv frontend/dist '$REMOTE_CODE_BACKUP/original-dist'
    mv -Tf '.deploy/dist-stable-$RELEASE_ID' frontend/dist
  fi

  ln -s '$REMOTE_RELEASE' '.deploy/current-next-$RELEASE_ID'
  mv -Tf '.deploy/current-next-$RELEASE_ID' '.deploy/current'
"

info "restart service and verify API, index, and every built frontend asset"
if ! restart_and_wait \
  "$REMOTE_RELEASE/frontend/dist" \
  "$REMOTE_RELEASE/scripts/sqlite_online_backup.py" \
  "$LIVE_DB_SOURCE"; then
  fail "new release failed service or frontend verification"
fi

info "verify public health, index, and every built frontend asset"
if ! verify_public_frontend "$SOURCE_ROOT/frontend/dist"; then
  fail "new release failed public frontend verification"
fi

info "run the idempotent owner repair again under the new release"
if ! OWNER_VERIFY_OUTPUT="$(ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "
  '$REMOTE_DIR/.venv-py312/bin/python' '$REMOTE_RELEASE/scripts/repair_work_item_owners.py' \\
    --database '$LIVE_DB_SOURCE' \\
    --expect-revision '$EXPECTED_DB_REVISION' \\
    --apply
")"; then
  fail "post-deploy work-item owner verification failed"
fi
printf '%s\n' "$OWNER_VERIFY_OUTPUT"

ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "set -e
  cp '$REMOTE_RELEASE/release-manifest.json' '$REMOTE_DIR/.deploy/manifest.next'
  mv -f '$REMOTE_DIR/.deploy/manifest.next' '$REMOTE_DIR/release-manifest.json'
"

DEPLOY_SUCCEEDED=1
release_lock
trap - ERR INT TERM HUP
info "deployment complete: release=$RELEASE_ID"
info "code rollback source: $REMOTE_CODE_BACKUP"
info "database snapshot: $REMOTE_DB_BACKUP"
