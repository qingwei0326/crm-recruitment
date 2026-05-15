#!/bin/bash
# ============================================================
# CRM Database Backup Script
# Usage: ./backup.sh [--rclone]
# Crontab: 0 2 * * * /path/to/backup.sh >> /var/log/crm-backup.log 2>&1
# ============================================================
set -euo pipefail

# ---- Config ----
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
DB_PATH="${DB_PATH:-/app/data/crm.db}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ---- Ensure backup dir exists ----
mkdir -p "$BACKUP_DIR"

# ---- Step 1: Consistent copy via SQLite .backup ----
echo "[$(date)] Starting backup for: $DB_PATH"
BACKUP_FILE="$BACKUP_DIR/crm_$TIMESTAMP.db"

if command -v sqlite3 &>/dev/null; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
    echo "[$(date)] SQLite backup created: $BACKUP_FILE"
else
    # Fallback: direct copy (safe when no concurrent writes)
    cp "$DB_PATH" "$BACKUP_FILE"
    echo "[$(date)] Direct copy created (sqlite3 not found): $BACKUP_FILE"
fi

# ---- Step 2: Compress ----
gzip -f "$BACKUP_FILE"
ARCHIVE="$BACKUP_FILE.gz"
ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "[$(date)] Compressed: $ARCHIVE ($ARCHIVE_SIZE)"

# ---- Step 3: Rotate old backups ----
DELETED=$(find "$BACKUP_DIR" -name "crm_*.db.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo "[$(date)] Rotated $DELETED old backup(s) (retention: ${RETENTION_DAYS}d)"

# ---- Step 4: Optional rclone sync ----
if [ -n "$RCLONE_REMOTE" ] && command -v rclone &>/dev/null; then
    echo "[$(date)] Syncing to rclone remote: $RCLONE_REMOTE"
    rclone copy "$ARCHIVE" "$RCLONE_REMOTE/crm-backups/"
    echo "[$(date)] Rclone sync complete"
elif [ -n "$RCLONE_REMOTE" ]; then
    echo "[$(date)] WARNING: rclone not found, skipping remote sync"
fi

# ---- Summary ----
echo "[$(date)] Backup complete. Local backups: $(ls "$BACKUP_DIR"/crm_*.db.gz 2>/dev/null | wc -l)"
