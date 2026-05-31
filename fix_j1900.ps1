#!/usr/bin/env pwsh
# J1900 数据库一键修复脚本（PowerShell 版本）
# 修复 500 错误：添加缺失的数据库字段

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "J1900 数据库修复脚本" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 检测项目目录
$ProjectDir = $null
$PossibleDirs = @("D:\CRM", "D:\招生系统", "$HOME\招生系统")

foreach ($Dir in $PossibleDirs) {
    if (Test-Path $Dir) {
        $ProjectDir = $Dir
        break
    }
}

if (-not $ProjectDir) {
    Write-Host "❌ 找不到项目目录" -ForegroundColor Red
    Write-Host "请手动指定项目路径：" -ForegroundColor Yellow
    Write-Host '  $env:PROJECT_DIR = "D:\CRM"' -ForegroundColor White
    Write-Host "  然后重新运行此脚本" -ForegroundColor White
    exit 1
}

Write-Host "项目目录: $ProjectDir" -ForegroundColor Green
Set-Location $ProjectDir

# 检查数据库
if (-not (Test-Path "crm.db")) {
    Write-Host "❌ 找不到数据库文件: crm.db" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[1/4] 备份数据库..." -ForegroundColor Yellow
$BackupFile = "crm.db.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item "crm.db" $BackupFile
Write-Host "✓ 备份完成: $BackupFile" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] 检查字段是否已存在..." -ForegroundColor Yellow

# 检查 users 表字段
$TableInfo = sqlite3 crm.db "PRAGMA table_info(users);"
$HasTokenVersion = $TableInfo -match "token_version"
$HasLoginDevice = $TableInfo -match "last_login_device"
$HasLoginIp = $TableInfo -match "last_login_ip"

if ($HasTokenVersion -and $HasLoginDevice -and $HasLoginIp) {
    Write-Host "✓ 所有字段已存在，无需迁移" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "[3/4] 执行数据库迁移..." -ForegroundColor Yellow

# 添加 token_version
if (-not $HasTokenVersion) {
    Write-Host "  添加 token_version..." -ForegroundColor Gray
    sqlite3 crm.db "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;"
    Write-Host "  ✓ token_version 已添加" -ForegroundColor Green
} else {
    Write-Host "  ✓ token_version 已存在" -ForegroundColor Green
}

# 添加 last_login_device
if (-not $HasLoginDevice) {
    Write-Host "  添加 last_login_device..." -ForegroundColor Gray
    sqlite3 crm.db "ALTER TABLE users ADD COLUMN last_login_device VARCHAR(512) DEFAULT '' NOT NULL;"
    Write-Host "  ✓ last_login_device 已添加" -ForegroundColor Green
} else {
    Write-Host "  ✓ last_login_device 已存在" -ForegroundColor Green
}

# 添加 last_login_ip
if (-not $HasLoginIp) {
    Write-Host "  添加 last_login_ip..." -ForegroundColor Gray
    sqlite3 crm.db "ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL;"
    Write-Host "  ✓ last_login_ip 已添加" -ForegroundColor Green
} else {
    Write-Host "  ✓ last_login_ip 已存在" -ForegroundColor Green
}

# 修改 operation_logs.operator_id 为 nullable
Write-Host "  修改 operation_logs.operator_id 为 nullable..." -ForegroundColor Gray

$SqlScript = @"
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
"@

$SqlScript | sqlite3 crm.db
Write-Host "  ✓ operation_logs 表已更新" -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] 验证迁移结果..." -ForegroundColor Yellow
sqlite3 crm.db "PRAGMA table_info(users);" | Select-String -Pattern "token_version|last_login_device|last_login_ip"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "✓ 数据库迁移完成！" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "现在重启服务：" -ForegroundColor Yellow
Write-Host "  .\stop.sh; .\start.sh" -ForegroundColor White
Write-Host ""
Write-Host "如果出现问题，可以恢复备份：" -ForegroundColor Yellow
Write-Host "  Copy-Item $BackupFile crm.db" -ForegroundColor White
Write-Host ""
