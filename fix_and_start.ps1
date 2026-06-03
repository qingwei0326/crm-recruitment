$ErrorActionPreference = "Stop"
$Root = "D:\CRM"
Set-Location $Root

Write-Host "=== CRM 一键修复启动脚本 ===" -ForegroundColor Cyan

# 1. 设置 SECRET_KEY
$SecretFile = Join-Path $Root ".secret_key"
if (Test-Path $SecretFile) {
    $env:SECRET_KEY = (Get-Content -Raw -Encoding UTF8 $SecretFile).Trim()
    Write-Host "[1/5] SECRET_KEY 已加载" -ForegroundColor Green
} else {
    Write-Host "[1/5] 生成 SECRET_KEY..." -ForegroundColor Yellow
    $env:SECRET_KEY = py -c "import secrets; print(secrets.token_hex(32))"
    $env:SECRET_KEY | Out-File -FilePath $SecretFile -NoNewline -Encoding UTF8
}

# 2. 清理残留表
Write-Host "[2/5] 清理残留表..." -ForegroundColor Yellow
py -c "import sqlite3; c=sqlite3.connect('$Root/crm.db'); c.execute('DROP TABLE IF EXISTS operation_logs_new'); c.commit(); c.close(); print('done')"
Write-Host "  完成" -ForegroundColor Green

# 3. 修复 database.py
Write-Host "[3/5] 修复数据库迁移代码..." -ForegroundColor Yellow
$DbPy = Join-Path $Root "app\database.py"
$Content = Get-Content -Raw -Encoding UTF8 $DbPy

$OldBlock = @'
    else:
        # SQLite 不支持 ALTER COLUMN，需要重建表
        sync_connection.execute(text("""
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
            )
        """))

        sync_connection.execute(text(
            "INSERT INTO operation_logs_new SELECT * FROM operation_logs"
        ))

        sync_connection.execute(text("DROP TABLE operation_logs"))
        sync_connection.execute(text("ALTER TABLE operation_logs_new RENAME TO operation_logs"))

        # 重建索引
        sync_connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at)"
        ))
        sync_connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id)"
        ))
'@

$NewBlock = @'
    else:
        # SQLite 不支持 ALTER COLUMN，需要重建表
        # 动态获取当前列，只修改 operator_id 为 nullable
        col_names = [c["name"] for c in columns]
        col_defs = []
        for c in columns:
            if c["name"] == "operator_id":
                col_defs.append("operator_id INTEGER")
            else:
                col_type = str(c["type"])
                nullable = "NOT NULL" if not c.get("nullable", True) else ""
                default = ""
                if c.get("default") is not None:
                    default_val = str(c["default"])
                    if "CURRENT_TIMESTAMP" in default_val:
                        default = "DEFAULT CURRENT_TIMESTAMP"
                    elif "nextval" in default_val:
                        default = ""
                    else:
                        default = f"DEFAULT {default_val}"
                pk = " PRIMARY KEY AUTOINCREMENT" if c.get("primary_key") else ""
                col_defs.append(f"    {c['name']} {col_type}{pk} {nullable} {default}".strip())

        create_sql = "CREATE TABLE operation_logs_new (\n" + ",\n".join(col_defs) + "\n)"
        sync_connection.execute(text(create_sql))

        cols_str = ", ".join(col_names)
        sync_connection.execute(text(
            f"INSERT INTO operation_logs_new ({cols_str}) SELECT {cols_str} FROM operation_logs"
        ))

        sync_connection.execute(text("DROP TABLE operation_logs"))
        sync_connection.execute(text("ALTER TABLE operation_logs_new RENAME TO operation_logs"))

        sync_connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at)"
        ))
        sync_connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id)"
        ))
'@

if ($Content -match "INSERT INTO operation_logs_new SELECT \* FROM operation_logs") {
    $Content = $Content -replace [regex]::Escape($OldBlock), $NewBlock
    [System.IO.File]::WriteAllText($DbPy, $Content, [System.Text.Encoding]::UTF8)
    Write-Host "  database.py 已修复" -ForegroundColor Green
} else {
    Write-Host "  已是最新版本，跳过" -ForegroundColor Green
}

# 4. 迁移数据库
Write-Host "[4/5] 迁移数据库..." -ForegroundColor Yellow
py init_db.py
Write-Host "  完成" -ForegroundColor Green

# 5. 启动服务
Write-Host "[5/5] 启动服务..." -ForegroundColor Yellow
Write-Host ""
Write-Host "=== 启动成功 ===" -ForegroundColor Green
Write-Host "访问: http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "公网: https://crm.qing-wei.com" -ForegroundColor Cyan
Write-Host ""
py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
