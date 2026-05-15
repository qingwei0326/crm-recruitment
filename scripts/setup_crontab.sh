#!/bin/bash
# ============================================================
# Setup Crontab for CRM Operations
# Run once to install cron jobs:
#   chmod +x scripts/setup_crontab.sh
#   sudo ./scripts/setup_crontab.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
PUSHPLUS_SCRIPT="$SCRIPT_DIR/pushplus_notify.py"
LOG_DIR="/var/log/crm"

mkdir -p "$LOG_DIR"

# Write crontab entries (idempotent — removes old CRM entries first)
CRON_MARKER="# CRM-AUTO"

# Remove existing CRM crontab entries
crontab -l 2>/dev/null | grep -v "$CRON_MARKER" > /tmp/crontab.tmp || true

cat >> /tmp/crontab.tmp <<EOF
# ============================================================
$CRON_MARKER
# ============================================================
# CRM Backup — daily at 2:00 AM
0 2 * * * bash $BACKUP_SCRIPT >> $LOG_DIR/backup.log 2>&1

# CRM Daily Report via PushPlus — daily at 20:00
0 20 * * * cd $PROJECT_DIR && DATABASE_PATH=$PROJECT_DIR/crm.db python3 $PUSHPLUS_SCRIPT >> $LOG_DIR/pushplus.log 2>&1
$CRON_MARKER-END
EOF

crontab /tmp/crontab.tmp
rm /tmp/crontab.tmp

echo "============================================"
echo " Crontab installed successfully"
echo "============================================"
echo ""
echo "Scheduled jobs:"
echo "  0  2 * * *  backup.sh       → $LOG_DIR/backup.log"
echo "  0 20 * * *  pushplus_notify → $LOG_DIR/pushplus.log"
echo ""
echo "Verify: crontab -l"
echo "Logs:   ls $LOG_DIR/"
echo ""
echo "IMPORTANT: Set environment variables:"
echo "  export PUSHPLUS_TOKEN=your_pushplus_token"
echo "  export RCLONE_REMOTE=gdrive:crm-backups  (optional)"
echo "============================================"
