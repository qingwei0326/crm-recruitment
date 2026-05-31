#!/bin/bash
# J1900 数据库一键修复脚本
# 修复 500 错误：添加缺失的数据库字段

set -e

echo "=========================================="
echo "J1900 数据库修复脚本"
echo "=========================================="
echo ""

# 检测项目目录
if [ -d "/home/user/招生系统" ]; then
    PROJECT_DIR="/home/user/招生系统"
elif [ -d "$HOME/招生系统" ]; then
    PROJECT_DIR="$HOME/招生系统"
elif [ -d "D:/CRM" ]; then
    PROJECT_DIR="D:/CRM"
elif [ -d "/d/CRM" ]; then
    PROJECT_DIR="/d/CRM"
else
    echo "❌ 找不到项目目录"
    echo "请手动指定项目路径："
    echo "  export PROJECT_DIR=/path/to/project"
    echo "  然后重新运行此脚本"
    exit 1
fi

echo "项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

# 检查数据库
if [ ! -f "crm.db" ]; then
    echo "❌ 找不到数据库文件: crm.db"
    exit 1
fi

echo ""
echo "[1/4] 备份数据库..."
BACKUP_FILE="crm.db.backup_$(date +%Y%m%d_%H%M%S)"
cp crm.db "$BACKUP_FILE"
echo "✓ 备份完成: $BACKUP_FILE"

echo ""
echo "[2/4] 检查字段是否已存在..."

# 检查 users 表
HAS_TOKEN_VERSION=$(sqlite3 crm.db "PRAGMA table_info(users);" | grep -c "token_version" || true)
HAS_LOGIN_DEVICE=$(sqlite3 crm.db "PRAGMA table_info(users);" | grep -c "last_login_device" || true)
HAS_LOGIN_IP=$(sqlite3 crm.db "PRAGMA table_info(users);" | grep -c "last_login_ip" || true)

if [ "$HAS_TOKEN_VERSION" -gt 0 ] && [ "$HAS_LOGIN_DEVICE" -gt 0 ] && [ "$HAS_LOGIN_IP" -gt 0 ]; then
    echo "✓ 所有字段已存在，无需迁移"
    exit 0
fi

echo ""
echo "[3/4] 执行数据库迁移..."

# 添加 token_version
if [ "$HAS_TOKEN_VERSION" -eq 0 ]; then
    echo "  添加 token_version..."
    sqlite3 crm.db "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;"
    echo "  ✓ token_version 已添加"
else
    echo "  ✓ token_version 已存在"
fi

# 添加 last_login_device
if [ "$HAS_LOGIN_DEVICE" -eq 0 ]; then
    echo "  添加 last_login_device..."
    sqlite3 crm.db "ALTER TABLE users ADD COLUMN last_login_device VARCHAR(512) DEFAULT '' NOT NULL;"
    echo "  ✓ last_login_device 已添加"
else
    echo "  ✓ last_login_device 已存在"
fi

# 添加 last_login_ip
if [ "$HAS_LOGIN_IP" -eq 0 ]; then
    echo "  添加 last_login_ip..."
    sqlite3 crm.db "ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL;"
    echo "  ✓ last_login_ip 已添加"
else
    echo "  ✓ last_login_ip 已存在"
fi

# 修改 operation_logs.operator_id 为 nullable
echo "  修改 operation_logs.operator_id 为 nullable..."
sqlite3 crm.db <<'EOF'
BEGIN TRANSACTION;

CREATE TABLE operation_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_id INTEGER,
    operator_name VARCHAR(64) NOT NULL,
    target_student_id INTEGER,
    case_no VARCHAR(36) DEFAULT '',
    action VARCHAR(64) NOT NULL,
    details TEXT DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id) REFERENCES users(id)
);

INSERT INTO operation_logs_new SELECT * FROM operation_logs;
DROP TABLE operation_logs;
ALTER TABLE operation_logs_new RENAME TO operation_logs;

CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id);

COMMIT;
EOF

echo "  ✓ operation_logs 表已更新"

echo ""
echo "[4/4] 验证迁移结果..."
sqlite3 crm.db "PRAGMA table_info(users);" | grep -E "token_version|last_login_device|last_login_ip"

echo ""
echo "=========================================="
echo "✓ 数据库迁移完成！"
echo "=========================================="
echo ""
echo "现在重启服务："
echo "  ./stop.sh && ./start.sh"
echo ""
echo "如果出现问题，可以恢复备份："
echo "  cp $BACKUP_FILE crm.db"
echo ""
