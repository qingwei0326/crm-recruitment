$ErrorActionPreference = "Stop"
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dst = Join-Path ([Environment]::GetFolderPath("Desktop")) "crm-j1900-package"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ZipName = "crm_$Timestamp.zip"

if (Test-Path $Dst) { Remove-Item $Dst -Recurse -Force }
New-Item -ItemType Directory -Path $Dst | Out-Null
New-Item -ItemType Directory -Path "$Dst\crm" | Out-Null

Write-Host "正在复制项目文件..."
robocopy $Src "$Dst\crm" /E /XD node_modules .git __pycache__ .pytest_cache .ruff_cache .venv .venv-win venv dist build backups releases .claude /XF *.log *.log.old *.db *.pid *.db.backup_* /NFL /NDL /NJH /NJS | Out-Null

Write-Host "正在压缩..."
Compress-Archive -Path "$Dst\crm\*" -DestinationPath "$Dst\$ZipName" -Force
Remove-Item "$Dst\crm" -Recurse -Force

$Readme = @"
========================================
招生系统 CRM - J1900 迁移包
========================================
打包时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

文件: $ZipName

迁移步骤:
1. 解压到 J1900 的 D:\CRM
2. 复制运行时文件到 D:\CRM（如果 J1900 上已有则不用动）:
   - crm.db      (数据库)
   - .secret_key  (密钥)
   - .env         (环境变量，可选)
3. 安装 Python 依赖:
   cd D:\CRM
   .\.venv-win\Scripts\pip.exe install -r requirements.txt
   .\.venv-win\Scripts\pip.exe install httpx
4. 初始化/迁移数据库:
   .\.venv-win\Scripts\python.exe init_db.py
5. 设置开机启动:
   powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
6. 启动:
   powershell -ExecutionPolicy Bypass -File .\start.ps1

访问: http://127.0.0.1:8000
公网: https://crm.qing-wei.com
========================================
"@
$Readme | Out-File -FilePath "$Dst\迁移说明.txt" -Encoding UTF8

Write-Host ""
Write-Host "打包完成!" -ForegroundColor Green
Get-ChildItem $Dst -File | ForEach-Object {
    $Size = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  $($_.Name)  $Size MB"
}
Write-Host ""
Write-Host "位置: $Dst" -ForegroundColor Cyan
