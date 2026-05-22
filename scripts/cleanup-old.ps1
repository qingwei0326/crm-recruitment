# 招生系统 · 旧文件清理脚本
#
# 默认 dry-run：只列出会删什么，不动文件。
# 确认要删时加 -Apply 参数。
#
# 用法：
#   .\cleanup-old.ps1                         # 预览，不删
#   .\cleanup-old.ps1 -Apply                  # 真正删除
#   .\cleanup-old.ps1 -Apply -KeepBackups 3   # 只保留最近 3 份 db 备份（默认 5）
#   .\cleanup-old.ps1 -Apply -Target D:\CRM   # 指定项目根（默认当前目录）

param(
    [string]$Target = (Get-Location).Path,
    [switch]$Apply,
    [int]$KeepBackups = 5,
    [int]$KeepReleases = 1
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath($Target).TrimEnd("\")

if (-not (Test-Path $Root)) {
    throw "目录不存在：$Root"
}

Write-Host "项目根：$Root" -ForegroundColor Cyan
Write-Host "模式：$(if ($Apply) { '真正删除' } else { '预览（dry-run）' })" -ForegroundColor Cyan

# 提示：服务跑着时删 log 可能因句柄占用失败
if (Test-Path (Join-Path $Root "backend.pid")) {
    Write-Host "检测到 backend.pid，服务可能在运行。" -ForegroundColor Yellow
    Write-Host "建议先 stop.bat 停服务，跑完清理再 start.ps1。" -ForegroundColor Yellow
}
Write-Host ""

$totalSize = 0
$toDelete = @()

function Add-Target {
    param([string]$Path, [string]$Reason)
    if (-not (Test-Path $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    $size = 0
    if ($item.PSIsContainer) {
        $size = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
                 Measure-Object -Property Length -Sum).Sum
        if (-not $size) { $size = 0 }
    } else {
        $size = $item.Length
    }
    $script:totalSize += $size
    $script:toDelete += [pscustomobject]@{
        Path = $Path
        Size = $size
        Reason = $Reason
    }
}

# ── 1) 运行日志 ──
# 注：不动 *.pid —— stop.ps1 靠它找进程。建议先 stop.bat 再跑本脚本。
foreach ($name in @(
    "backend_out.log","backend_err.log",
    "forward.log","forward_out.log","forward_err.log",
    "startup.log"
)) {
    Add-Target -Path (Join-Path $Root $name) -Reason "运行时日志"
}

# ── 2) Python 缓存（仅项目代码目录，不动依赖目录里的）──
$DepDirs = @(".venv", ".venv-win", "venv", ".pydeps", "node_modules")
Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -eq "__pycache__" -or $_.Name -eq ".pytest_cache" -or $_.Name -eq ".ruff_cache") -and
        ($_.FullName.Substring($Root.Length) -split '[\\/]' | Where-Object { $DepDirs -contains $_ }).Count -eq 0
    } |
    ForEach-Object { Add-Target -Path $_.FullName -Reason "Python 缓存" }

# ── 3) 旧评审/打包文件 ──
foreach ($name in @("project_review.txt","project_review_bundle.txt","project_all.txt")) {
    Add-Target -Path (Join-Path $Root $name) -Reason "评审/打包临时文件"
}
Get-ChildItem -LiteralPath $Root -File -Filter "review-*.patch" -ErrorAction SilentlyContinue |
    ForEach-Object { Add-Target -Path $_.FullName -Reason "历史 patch 文件" }

# ── 4) 旧 release（保留最新 N 个 zip + 删所有解压目录）──
$ReleaseDir = Join-Path $Root "releases"
if (Test-Path $ReleaseDir) {
    $zips = Get-ChildItem -LiteralPath $ReleaseDir -File -Filter "*.zip" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
    $toKill = @($zips | Select-Object -Skip $KeepReleases)
    foreach ($z in $toKill) {
        Add-Target -Path $z.FullName -Reason "旧 release zip（保留最近 $KeepReleases 个）"
    }
    Get-ChildItem -LiteralPath $ReleaseDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Add-Target -Path $_.FullName -Reason "release 解压目录（zip 已足够）"
    }
}

# ── 5) 旧 db 备份（保留最近 N 个）──
$BackupDir = Join-Path $Root "backups"
if (Test-Path $BackupDir) {
    $dbs = Get-ChildItem -LiteralPath $BackupDir -File -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -like "*.db*" -or $_.Name -like "crm*" } |
           Sort-Object LastWriteTime -Descending
    $toKill = @($dbs | Select-Object -Skip $KeepBackups)
    foreach ($f in $toKill) {
        Add-Target -Path $f.FullName -Reason "旧 db 备份（保留最近 $KeepBackups 份）"
    }
}

# ── 6) 前端构建产物（重启时会重新 build）──
$Dist = Join-Path $Root "frontend\dist"
if (Test-Path $Dist) {
    Add-Target -Path $Dist -Reason "前端 dist（start.ps1 启动时会重新构建）"
}

# ── 7) 旧日志轮转文件（.old）──
Get-ChildItem -LiteralPath $Root -File -Filter "*.old" -ErrorAction SilentlyContinue |
    ForEach-Object { Add-Target -Path $_.FullName -Reason "旧日志轮转文件" }

# ── 8) 替代部署方式配置（你用 start.ps1，下面这些都用不到）──
foreach ($name in @(
    "Dockerfile","docker-compose.yml",".dockerignore",
    "ecosystem.config.js",
    "nginx.conf",
    "cloudflared-config.yml"
)) {
    Add-Target -Path (Join-Path $Root $name) -Reason "替代部署配置（未在用）"
}

# ── 9) 迁移残留（跑完回填脚本后就不需要了）──
foreach ($name in @(
    "MIGRATE_REGION.md",
    "migrate_backfill.py",
    "release-manifest.json"
)) {
    Add-Target -Path (Join-Path $Root $name) -Reason "迁移/发布残留"
}

# ── 输出 ──
if ($toDelete.Count -eq 0) {
    Write-Host "没有可清理的文件。" -ForegroundColor Green
    return
}

$toDelete | Sort-Object Size -Descending | ForEach-Object {
    $sizeMB = if ($_.Size -gt 0) { "{0,8:N2} MB" -f ($_.Size / 1MB) } else { "       0 MB" }
    Write-Host "$sizeMB  $($_.Reason)" -NoNewline
    Write-Host "  $($_.Path)" -ForegroundColor Gray
}

$totalMB = [math]::Round($totalSize / 1MB, 2)
Write-Host ""
Write-Host "合计：$($toDelete.Count) 项，约 $totalMB MB" -ForegroundColor Yellow

if (-not $Apply) {
    Write-Host ""
    Write-Host "这是预览。确认无误后加 -Apply 真正删除：" -ForegroundColor Cyan
    Write-Host "  .\cleanup-old.ps1 -Apply" -ForegroundColor Cyan
    return
}

Write-Host ""
Write-Host "执行删除..." -ForegroundColor Yellow
$failed = 0
foreach ($t in $toDelete) {
    try {
        if ((Get-Item -LiteralPath $t.Path -Force).PSIsContainer) {
            Remove-Item -LiteralPath $t.Path -Recurse -Force
        } else {
            Remove-Item -LiteralPath $t.Path -Force
        }
    } catch {
        $failed++
        Write-Warning "删除失败：$($t.Path) — $($_.Exception.Message)"
    }
}
Write-Host "完成。释放约 $totalMB MB，失败 $failed 项。" -ForegroundColor Green
