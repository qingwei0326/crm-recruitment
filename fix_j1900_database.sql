-- 一键修复 J1900 数据库 schema
-- 添加缺失的字段

-- 1. 添加 users 表的新字段
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login_device VARCHAR(512) DEFAULT '' NOT NULL;
ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL;

-- 2. 修改 operation_logs.operator_id 为 nullable
-- SQLite 不支持直接修改列，需要重建表

-- 创建新表
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

-- 复制数据
INSERT INTO operation_logs_new SELECT * FROM operation_logs;

-- 删除旧表
DROP TABLE operation_logs;

-- 重命名新表
ALTER TABLE operation_logs_new RENAME TO operation_logs;

-- 重建索引
CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id);
