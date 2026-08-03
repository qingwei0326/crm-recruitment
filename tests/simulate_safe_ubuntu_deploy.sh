#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:?usage: simulate_safe_ubuntu_deploy.sh RELEASE_DIR}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/scripts/safe-ubuntu-deploy.sh"
WORK="$(mktemp -d)"
FAKE_BIN="$WORK/bin"
FAKE_HOME="$WORK/home"
STATE="$WORK/state"
REMOTE="$WORK/remote"
SSH_KEY="$WORK/fake-key"
KNOWN_HOSTS_FILE="$WORK/known_hosts"

cleanup() {
  if [[ -f "$STATE/pid" ]]; then
    kill "$(cat "$STATE/pid")" >/dev/null 2>&1 || true
  fi
  chmod -R u+w "$WORK" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$STATE"
touch "$SSH_KEY" "$KNOWN_HOSTS_FILE"

cat >"$FAKE_BIN/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
strict_host_key=0
known_hosts_file=0
while (($#)); do
  case "$1" in
    -i|-p) shift 2 ;;
    -o)
      [[ "$2" == StrictHostKeyChecking=yes ]] && strict_host_key=1
      [[ "$2" == UserKnownHostsFile=* ]] && known_hosts_file=1
      shift 2
      ;;
    *@*) shift; break ;;
    *) shift ;;
  esac
done
if [[ "${FAKE_REQUIRE_STRICT_SSH:-0}" == 1 && ("$strict_host_key" != 1 || "$known_hosts_file" != 1) ]]; then
  echo 'strict SSH host-key verification was not configured' >&2
  exit 255
fi
if [[ "${FAKE_GUARD_FAIL:-}" == kill ]]; then
  kill() {
    if [[ "${1:-}" == -0 ]]; then
      return 1
    fi
    builtin kill "$@"
  }
  export -f kill
fi
PATH="$FAKE_BIN:$PATH" HOME="$FAKE_HOME" bash -c "${1:-}"
EOF

cat >"$FAKE_BIN/rsync" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=()
while (($#)); do
  if [[ "$1" == -e ]]; then
    shift 2
  elif [[ "$1" == *@*:* ]]; then
    args+=("${1#*:}")
    shift
  else
    args+=("$1")
    shift
  fi
done
exec /usr/bin/rsync "${args[@]}"
EOF

cat >"$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

process_is_running() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  builtin kill -0 "$pid" >/dev/null 2>&1 || return 1
  [[ "$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)" != Z ]]
}

start_process() {
  if [[ -f "$FAKE_STATE/pid" ]]; then
    builtin kill "$(cat "$FAKE_STATE/pid")" >/dev/null 2>&1 || true
  fi
  (
    cd "$FAKE_REMOTE"
    nohup env DATABASE_PATH=crm.db SECRET_KEY=test APP_ENV=development \
      sleep 10000 >/dev/null 2>&1 &
    echo $! >"$FAKE_STATE/pid"
  )
  count=0
  [[ -f "$FAKE_STATE/restarts" ]] && count="$(cat "$FAKE_STATE/restarts")"
  echo $((count + 1)) >"$FAKE_STATE/restarts"
}

main_pid() {
  if [[ "${FAKE_GUARD_FAIL:-}" == main_pid ]]; then
    echo 0
    return
  fi
  local pid
  pid="$(cat "$FAKE_STATE/pid")"
  if [[ "${FAKE_SERVICE_CONTROL:-direct}" == signal ]] && ! process_is_running "$pid"; then
    start_process
    pid="$(cat "$FAKE_STATE/pid")"
  fi
  echo "$pid"
}

args=" $* "
if [[ "$args" == *" show "*" MainPID "* ]]; then
  main_pid
elif [[ "$args" == *" show "*" Restart "* ]]; then
  if [[ "${FAKE_GUARD_FAIL:-}" == policy ]]; then echo on-failure; else echo always; fi
elif [[ "$args" == *" is-active "* ]]; then
  if [[ "${FAKE_GUARD_FAIL:-}" == active ]]; then echo inactive; exit 3; else echo active; fi
elif [[ "$args" == *" reset-failed "* ]]; then
  case "${FAKE_SERVICE_CONTROL:-direct}" in
    direct) exit 0 ;;
    sudo) [[ "${FAKE_VIA_SUDO:-0}" == 1 ]] ;;
    signal) exit 1 ;;
    *) exit 2 ;;
  esac
elif [[ "$args" == *" restart "* ]]; then
  case "${FAKE_SERVICE_CONTROL:-direct}" in
    direct) start_process ;;
    sudo) [[ "${FAKE_VIA_SUDO:-0}" == 1 ]] && start_process ;;
    signal) echo 'unexpected systemctl restart in signal mode' >&2; exit 1 ;;
    *) exit 2 ;;
  esac
else
  exit 0
fi
EOF

cat >"$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == -n ]] && shift
FAKE_VIA_SUDO=1 exec "$@"
EOF

cat >"$FAKE_BIN/cat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" == 1 && "$1" == /proc/*/cgroup ]]; then
  if [[ "${FAKE_GUARD_FAIL:-}" == cgroup ]]; then
    printf '0::/user.slice/user-1000.slice/session-1.scope\n'
  else
    printf '0::/system.slice/crm.service\n'
  fi
  exit 0
fi
exec /usr/bin/cat "$@"
EOF

cat >"$FAKE_BIN/ps" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${FAKE_GUARD_FAIL:-}" == owner ]]; then
  printf 'different-user\n'
  exit 0
fi
exec /usr/bin/ps "$@"
EOF

cat >"$FAKE_BIN/journalctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
seen_pin=0
while (($#)); do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    --pinnedpubkey)
      [[ "$2" == 'sha256//mn8PXhDLej6ELYJcxROMSkc1iV6PvaMA3q+epSmmDoc=' ]]
      seen_pin=1
      shift 2
      ;;
    -*) shift; [[ "${1:-}" =~ ^[0-9]+$ ]] && shift || true ;;
    *) url="$1"; shift ;;
  esac
done

clean_url="${url%%\?*}"
if [[ "$clean_url" == http://fake-public/* ]]; then
  printf '%s\n' "$clean_url" >>"$FAKE_STATE/public-requests"
  if [[ "$seen_pin" != 1 ]]; then
    echo 'public request missing expected SPKI pin' >&2
    exit 60
  fi
fi

if [[ "$url" == */api/health ]]; then
  restarts="$(cat "$FAKE_STATE/restarts" 2>/dev/null || echo 0)"
  if [[ "${FAKE_FAIL_FIRST_RELEASE:-0}" == 1 && "$restarts" -eq 1 ]]; then
    calls=0
    [[ -f "$FAKE_STATE/failed-health-calls" ]] && calls="$(cat "$FAKE_STATE/failed-health-calls")"
    calls=$((calls + 1))
    echo "$calls" >"$FAKE_STATE/failed-health-calls"
    if [[ "$calls" -eq 2 ]]; then
      systemctl --no-ask-password restart crm.service
    fi
    printf '{"code":1,"db":"error"}'
  else
    printf '{"code":0,"msg":"ok","db":"ok"}'
  fi
  exit 0
fi

if [[ "$clean_url" == http://fake-public/* ]]; then
  relative="${clean_url#http://fake-public/}"
  [[ -n "$relative" ]] || relative=index.html
  source="$FAKE_REMOTE/frontend/dist/$relative"
elif [[ "$clean_url" == http://127.0.0.1:8000/* ]]; then
  relative="${clean_url#http://127.0.0.1:8000/}"
  [[ -n "$relative" ]] || relative=index.html
  source="$FAKE_REMOTE/frontend/dist/$relative"
elif [[ "$clean_url" == */assets/* ]]; then
  source="$FAKE_REMOTE/frontend/dist/assets/${clean_url##*/}"
else
  source="$FAKE_REMOTE/frontend/dist/index.html"
fi
if [[ -n "$output" ]]; then
  cp "$source" "$output"
  if [[ "${FAKE_ASSET_MISMATCH:-0}" == 1 && "$clean_url" == *.css ]]; then
    printf 'corrupted served css' >"$output"
  fi
  if [[ "${FAKE_PUBLIC_ASSET_MISMATCH:-0}" == 1 && "$clean_url" == http://fake-public/manifest.json ]]; then
    printf 'corrupted public manifest' >"$output"
  fi
else
  cat "$source"
fi
EOF

chmod +x "$FAKE_BIN"/*

make_python_wrapper() {
  mkdir -p "$REMOTE/.venv-py312/bin"
  cat >"$REMOTE/.venv-py312/bin/python" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == -c && "${2:-}" == *"import alembic"* ]]; then
  echo 'python_runtime=ok alembic=1.13.1'
  exit 0
fi
if [[ "${1:-}" == -m && "${2:-}" == alembic ]]; then
  if [[ " $* " == *" heads "* ]]; then
    echo '20260726_01 (head)'
    exit 0
  fi
  if [[ " $* " == *" upgrade 20260726_01 "* ]]; then
    if [[ "${FAKE_MIGRATION_FAIL:-0}" == 1 ]]; then
      echo 'simulated migration failure' >&2
      exit 2
    fi
    python3 - "$DATABASE_PATH" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute("update alembic_version set version_num = '20260726_01'")
    connection.execute(
        "create table personal_groups (id integer primary key, name text not null)"
    )
PY
    echo 1 >"$FAKE_STATE/migration-applies"
    exit 0
  fi
fi
if [[ "${1:-}" == */repair_work_item_owners.py ]]; then
  apply=0
  for arg in "$@"; do
    [[ "$arg" == --apply ]] && apply=1
  done
  if [[ "$apply" == 0 ]]; then
    echo '{"applied": false, "planned_changes": 21, "planned_by_source_type": {"follow_up": 21}}'
    exit 1
  fi
  if [[ ! -d "$FAKE_HOME/deploy-backups" ]] || \
     ! find "$FAKE_HOME/deploy-backups" -maxdepth 1 -type f -name 'crm-db-*.db' | grep -q .; then
    echo '{"error": "repair_started_before_backup"}'
    exit 2
  fi
  if [[ "${FAKE_REPAIR_FAIL:-0}" == 1 ]]; then
    echo '{"error": "simulated_owner_repair_failure"}'
    exit 2
  fi
  count=0
  [[ -f "$FAKE_STATE/repair-applies" ]] && count="$(cat "$FAKE_STATE/repair-applies")"
  count=$((count + 1))
  echo "$count" >"$FAKE_STATE/repair-applies"
  if [[ "$count" == 1 ]]; then
    echo '{"after": {"ok": true}, "applied": true, "changed": 21, "planned_changes": 21}'
  else
    echo '{"after": {"ok": true}, "applied": true, "changed": 0, "planned_changes": 0}'
  fi
  exit 0
fi
exec python3 "$@"
EOF
  chmod +x "$REMOTE/.venv-py312/bin/python"
}

start_initial_process() {
  (
    cd "$REMOTE"
    nohup env DATABASE_PATH=crm.db SECRET_KEY=test APP_ENV=development \
      sleep 10000 >/dev/null 2>&1 &
    echo $! >"$STATE/pid"
  )
  echo 0 >"$STATE/restarts"
}

prepare_remote() {
  if [[ -f "$STATE/pid" ]]; then
    kill "$(cat "$STATE/pid")" >/dev/null 2>&1 || true
  fi
  chmod -R u+w "$REMOTE" "$FAKE_HOME/deploy-backups" >/dev/null 2>&1 || true
  rm -rf "$REMOTE" "$FAKE_HOME/deploy-backups"
  rm -f "$STATE"/*
  mkdir -p "$REMOTE/frontend" "$REMOTE/data"
  cp -a "$SOURCE_ROOT/app" "$REMOTE/app"
  cp -a "$SOURCE_ROOT/frontend/dist" "$REMOTE/frontend/dist"
  cp "$SOURCE_ROOT/requirements.txt" "$REMOTE/requirements.txt"
  python3 - "$REMOTE/requirements.txt" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
path.write_bytes(path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
PY
  cp "$SOURCE_ROOT/logging.json" "$REMOTE/logging.json"
  cp "$SOURCE_ROOT/data/school_regions.json" "$REMOTE/data/school_regions.json"
  printf '# old runtime marker\n' >>"$REMOTE/app/admin_daily_ops.py"
  printf '<!doctype html><html><body>old frontend<script src="/assets/old.js"></script></body></html>' \
    >"$REMOTE/frontend/dist/index.html"
  printf 'old asset' >"$REMOTE/frontend/dist/assets/old.js"
  printf 'SECRET_KEY=test\n' >"$REMOTE/.env"
  python3 - "$REMOTE/crm.db" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute("create table alembic_version (version_num text not null)")
    connection.execute("insert into alembic_version values ('20260714_01')")
    connection.execute("create table students (id integer primary key, name text)")
    connection.execute("insert into students (name) values ('simulation')")
PY
  make_python_wrapper
  start_initial_process
}

deploy() {
  PATH="$FAKE_BIN:$PATH" \
  FAKE_BIN="$FAKE_BIN" \
  FAKE_HOME="$FAKE_HOME" \
  FAKE_STATE="$STATE" \
  FAKE_REMOTE="$REMOTE" \
  FAKE_SERVICE_CONTROL="${FAKE_SERVICE_CONTROL:-direct}" \
  FAKE_GUARD_FAIL="${FAKE_GUARD_FAIL:-}" \
  FAKE_REPAIR_FAIL="${FAKE_REPAIR_FAIL:-0}" \
  FAKE_MIGRATION_FAIL="${FAKE_MIGRATION_FAIL:-0}" \
  FAKE_ASSET_MISMATCH="${FAKE_ASSET_MISMATCH:-0}" \
  FAKE_PUBLIC_ASSET_MISMATCH="${FAKE_PUBLIC_ASSET_MISMATCH:-0}" \
  FAKE_REQUIRE_PIN=1 \
  FAKE_REQUIRE_STRICT_SSH=1 \
  SSH_KEY="$SSH_KEY" \
  KNOWN_HOSTS_FILE="$KNOWN_HOSTS_FILE" \
  REMOTE_HOST=fake \
  REMOTE_PORT=22 \
  REMOTE_USER=test \
  REMOTE_DIR="$REMOTE" \
  EXPECTED_DB_PATH="$REMOTE/crm.db" \
  PUBLIC_BASE_URL=http://fake-public \
  ALLOW_PUBLIC_HTTP_FOR_TESTS=1 \
  SOURCE_ROOT="$SOURCE_ROOT" \
  bash "$DEPLOY_SCRIPT"
}

assert_no_lock() {
  [[ ! -e "$REMOTE/.deploy/deploy.lock" ]]
}

assert_new_release_active() {
  [[ "$(readlink "$REMOTE/.deploy/current")" == "$REMOTE/.deploy/releases/"* ]]
  [[ "$(readlink "$REMOTE/app")" == "$REMOTE/.deploy/current/app" ]]
  [[ "$(readlink "$REMOTE/frontend/dist")" == "$REMOTE/.deploy/current/frontend/dist" ]]
  if grep -q 'old frontend' "$REMOTE/frontend/dist/index.html"; then
    echo 'new frontend was not activated' >&2
    exit 1
  fi
  assert_no_lock
}

db_revision() {
  python3 - "$1" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    print(connection.execute("select version_num from alembic_version").fetchone()[0])
PY
}

prepare_remote
deploy
assert_new_release_active
[[ "$(db_revision "$REMOTE/crm.db")" == 20260726_01 ]]
[[ "$(cat "$STATE/migration-applies")" == 1 ]]
[[ "$(cat "$STATE/repair-applies")" == 2 ]]
[[ "$(stat -c %a "$(readlink "$REMOTE/.deploy/current")")" == 555 ]]
[[ "$(stat -c %a "$REMOTE/app/main.py")" == 444 ]]
db_backup="$(find "$FAKE_HOME/deploy-backups" -maxdepth 1 -type f -name 'crm-db-*.db' | head -n 1)"
[[ -n "$db_backup" && "$(stat -c %a "$db_backup")" == 600 ]]
[[ "$(db_revision "$db_backup")" == 20260714_01 ]]

live_release="$(readlink "$REMOTE/.deploy/current")"
if deploy >/dev/null 2>&1; then
  echo 'duplicate release unexpectedly succeeded' >&2
  exit 1
fi
[[ -d "$live_release" ]]
[[ "$(readlink "$REMOTE/.deploy/current")" == "$live_release" ]]
assert_no_lock

prepare_remote
python3 - "$REMOTE/crm.db" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute("update alembic_version set version_num = '20260726_01'")
    connection.execute(
        "create table personal_groups (id integer primary key, name text not null)"
    )
PY
deploy
assert_new_release_active
[[ ! -f "$STATE/migration-applies" ]]
already_current_backup="$(find "$FAKE_HOME/deploy-backups" -maxdepth 1 -type f -name 'crm-db-*.db' | head -n 1)"
[[ "$(db_revision "$already_current_backup")" == 20260726_01 ]]

prepare_remote
printf 'definitely-not-installed==9.9.9\r\n' >>"$REMOTE/requirements.txt"
if deploy >/dev/null 2>&1; then
  echo 'changed requirements unexpectedly succeeded' >&2
  exit 1
fi
[[ ! -e "$REMOTE/.deploy/current" ]]
assert_no_lock

prepare_remote
if FAKE_MIGRATION_FAIL=1 deploy >/dev/null 2>&1; then
  echo 'failed migration unexpectedly switched the release' >&2
  exit 1
fi
[[ ! -e "$REMOTE/.deploy/current" ]]
[[ "$(db_revision "$REMOTE/crm.db")" == 20260714_01 ]]
[[ "$(find "$FAKE_HOME/deploy-backups" -maxdepth 1 -type f -name 'crm-db-*.db' | wc -l)" == 1 ]]
assert_no_lock

prepare_remote
if FAKE_REPAIR_FAIL=1 deploy >/dev/null 2>&1; then
  echo 'failed owner repair unexpectedly switched the release' >&2
  exit 1
fi
[[ ! -e "$REMOTE/.deploy/current" ]]
[[ "$(db_revision "$REMOTE/crm.db")" == 20260726_01 ]]
[[ "$(find "$FAKE_HOME/deploy-backups" -maxdepth 1 -type f -name 'crm-db-*.db' | wc -l)" == 1 ]]
assert_no_lock

prepare_remote
FAKE_SERVICE_CONTROL=sudo deploy
assert_new_release_active
[[ "$(cat "$STATE/restarts")" == 1 ]]

prepare_remote
FAKE_SERVICE_CONTROL=signal deploy
assert_new_release_active
[[ "$(cat "$STATE/restarts")" == 1 ]]

for guard in active policy main_pid owner cgroup kill; do
  prepare_remote
  if FAKE_SERVICE_CONTROL=signal FAKE_GUARD_FAIL="$guard" deploy >/dev/null 2>&1; then
    echo "signal restart guard '$guard' unexpectedly allowed deployment" >&2
    exit 1
  fi
  [[ ! -e "$REMOTE/.deploy/current" ]]
  [[ "$(cat "$STATE/restarts")" == 0 ]]
  assert_no_lock
done

prepare_remote
if FAKE_PUBLIC_ASSET_MISMATCH=1 deploy >/dev/null 2>&1; then
  echo 'public manifest mismatch unexpectedly succeeded' >&2
  exit 1
fi
rollback_target="$(readlink "$REMOTE/.deploy/current")"
[[ "$rollback_target" == "$FAKE_HOME/deploy-backups/crm-code-"* ]]
grep -q 'old frontend' "$REMOTE/frontend/dist/index.html"
[[ "$(grep -Fxc 'http://fake-public/manifest.json' "$STATE/public-requests")" -ge 2 ]]
assert_no_lock

prepare_remote
if FAKE_ASSET_MISMATCH=1 deploy >/dev/null 2>&1; then
  echo 'served CSS mismatch unexpectedly succeeded' >&2
  exit 1
fi
rollback_target="$(readlink "$REMOTE/.deploy/current")"
[[ "$rollback_target" == "$FAKE_HOME/deploy-backups/crm-code-"* ]]
grep -q 'old frontend' "$REMOTE/frontend/dist/index.html"
assert_no_lock

prepare_remote
if FAKE_FAIL_FIRST_RELEASE=1 deploy >/dev/null 2>&1; then
  echo 'simulated unhealthy release unexpectedly succeeded' >&2
  exit 1
fi
rollback_target="$(readlink "$REMOTE/.deploy/current")"
[[ "$rollback_target" == "$FAKE_HOME/deploy-backups/crm-code-"* ]]
grep -q '# old runtime marker' "$REMOTE/app/admin_daily_ops.py"
grep -q 'old frontend' "$REMOTE/frontend/dist/index.html"
[[ "$(db_revision "$REMOTE/crm.db")" == 20260726_01 ]]
assert_no_lock

echo 'safe Ubuntu deployment simulation passed: migration, backup ordering, owner repair, restart modes, guards, dependency check, duplicate protection, rollback'
