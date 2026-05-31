#!/usr/bin/env pwsh
# Windows 打包脚本 - 准备迁移到 J1900
# 在当前 Windows 机器上运行

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "招生系统 CRM - 迁移打包脚本" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$ProjectDir = "D:\招生系统"
$BackupDir = "D:\招生系统_迁移包"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# 检查项目目录
if (-not (Test-Path $ProjectDir)) {
    Write-Host "[错误] 项目目录不存在: $ProjectDir" -ForegroundColor Red
    exit 1
}

# 创建备份目录
Write-Host "[1/6] 创建备份目录..." -ForegroundColor Yellow
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}
Write-Host "✓ 备份目录: $BackupDir" -ForegroundColor Green
Write-Host ""

# 备份数据库
Write-Host "[2/6] 备份数据库..." -ForegroundColor Yellow
$DbPath = Join-Path $ProjectDir "crm.db"
if (Test-Path $DbPath) {
    Copy-Item $DbPath -Destination "$BackupDir\crm_$Timestamp.db"
    Write-Host "✓ 数据库已备份: crm_$Timestamp.db" -ForegroundColor Green

    # 显示数据库大小
    $DbSize = (Get-Item $DbPath).Length / 1MB
    Write-Host "  数据库大小: $([math]::Round($DbSize, 2)) MB" -ForegroundColor Gray
} else {
    Write-Host "✗ 未找到数据库文件" -ForegroundColor Red
}
Write-Host ""

# 备份配置文件
Write-Host "[3/6] 备份配置文件..." -ForegroundColor Yellow
$EnvPath = Join-Path $ProjectDir ".env"
if (Test-Path $EnvPath) {
    Copy-Item $EnvPath -Destination "$BackupDir\.env.backup"
    Write-Host "✓ .env 文件已备份" -ForegroundColor Green
} else {
    Write-Host "! 未找到 .env 文件（可能使用环境变量）" -ForegroundColor Yellow
}
Write-Host ""

# 打包项目代码
Write-Host "[4/6] 打包项目代码..." -ForegroundColor Yellow
$ExcludeDirs = @(
    "node_modules",
    ".venv",
    ".venv-win",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
    "frontend\dist",
    "frontend\node_modules",
    "*.log",
    "*.log.old"
)

# 创建临时目录
$TempDir = Join-Path $BackupDir "temp_project"
if (Test-Path $TempDir) {
    Remove-Item $TempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TempDir | Out-Null

# 复制项目文件（排除不需要的目录）
Write-Host "  正在复制文件..." -ForegroundColor Gray
robocopy $ProjectDir $TempDir /E /XD $ExcludeDirs /XF *.log *.log.old /NFL /NDL /NJH /NJS | Out-Null

# 压缩项目
$ZipPath = "$BackupDir\crm_project_$Timestamp.zip"
Write-Host "  正在压缩..." -ForegroundColor Gray
Compress-Archive -Path $TempDir\* -DestinationPath $ZipPath -Force

# 清理临时目录
Remove-Item $TempDir -Recurse -Force

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "✓ 项目已打包: crm_project_$Timestamp.zip" -ForegroundColor Green
Write-Host "  压缩包大小: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Gray
Write-Host ""

# 创建迁移说明文件
Write-Host "[5/6] 创建迁移说明..." -ForegroundColor Yellow
$ReadmePath = "$BackupDir\迁移说明.txt"
@"
========================================
招生系统 CRM - J1900 迁移包
========================================

打包时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
打包机器: $env:COMPUTERNAME

文件清单:
---------
1. crm_$Timestamp.db          - 数据库备份
2. crm_project_$Timestamp.zip - 项目代码
3. .env.backup                - 环境变量配置（如果有）
4. 迁移说明.txt               - 本文件

迁移步骤:
---------
1. 将此目录下的所有文件传输到 J1900 设备
   - 使用 U盘、SCP 或其他方式

2. 在 J1900 上解压项目
   cd ~
   unzip crm_project_$Timestamp.zip -d 招生系统

3. 复制数据库
   cp crm_$Timestamp.db ~/招生系统/crm.db

4. 运行部署脚本
   cd ~/招生系统
   chmod +x scripts/deploy_j1900.sh
   ./scripts/deploy_j1900.sh

5. 访问系统
   http://j1900_ip

详细文档:
---------
请查看项目中的 J1900简易迁移.md

常见问题:
---------
如果访问报 500 错误，运行数据库迁移脚本:
  cd ~/招生系统
  export SECRET_KEY=$(cat .secret_key)
  .venv/bin/python scripts/migrate_db_schema.py
  ./stop.sh && ./start.sh

技术支持:
---------
如遇问题，请检查:
- 日志文件: ~/招生系统/backend.log
- 迁移脚本: scripts/migrate_db_schema.py

========================================
"@ | Out-File -FilePath $ReadmePath -Encoding UTF8

Write-Host "✓ 迁移说明已创建" -ForegroundColor Green
Write-Host ""

# 生成文件清单
Write-Host "[6/6] 生成文件清单..." -ForegroundColor Yellow
$Files = Get-ChildItem $BackupDir -File
$TotalSize = ($Files | Measure-Object -Property Length -Sum).Sum / 1MB

Write-Host ""
Write-Host "文件清单:" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
foreach ($File in $Files) {
    $Size = $File.Length / 1MB
    Write-Host "  $($File.Name)" -ForegroundColor White -NoNewline
    Write-Host " ($([math]::Round($Size, 2)) MB)" -ForegroundColor Gray
}
Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host "  总大小: $([math]::Round($TotalSize, 2)) MB" -ForegroundColor Cyan
Write-Host ""

# 完成
Write-Host "==========================================" -ForegroundColor Green
Write-Host "打包完成！" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "迁移包位置: $BackupDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "  1. 将 $BackupDir 目录传输到 J1900 设备" -ForegroundColor White
Write-Host "  2. 在 J1900 上解压并运行 deploy_j1900.sh" -ForegroundColor White
Write-Host "  3. 参考 docs/J1900迁移指南.md 完成部署" -ForegroundColor White
Write-Host ""
Write-Host "传输方式:" -ForegroundColor Yellow
Write-Host "  - U盘: 复制整个目录到 U盘" -ForegroundColor White
Write-Host "  - SCP: scp -r '$BackupDir' user@j1900_ip:/home/user/" -ForegroundColor White
Write-Host "  - 网络共享: 在 J1900 上挂载 Windows 共享" -ForegroundColor White
Write-Host ""

# 打开文件夹
$OpenFolder = Read-Host "是否打开迁移包目录? (Y/N)"
if ($OpenFolder -eq "Y" -or $OpenFolder -eq "y") {
    explorer $BackupDir
}
