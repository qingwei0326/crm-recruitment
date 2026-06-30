# 招生系统 · 旧文件清理脚本
#
# 默认 dry-run：只列出会删什么，不动文件。
# 确认要删时加 -Apply 参数。
#
# 用法：
#   .\cleanup-old.ps1                         # 预览，不删
#   .\cleanup-old.ps1 -Apply                  # 真正删除
#   .\cleanup-old.ps1 -Apply -PruneBackups -KeepBackups 3  # 只保留最近 3 份 db 备份
#   .\cleanup-old.ps1 -Apply -RemoveRuntimeLogs  # 额外删除当前运行日志
#   .\cleanup-old.ps1 -Apply -RemoveBuildArtifacts  # 额外删除前端 dist（会影响当前静态页面）
#   .\cleanup-old.ps1 -Apply -Target D:\CRM   # 指定项目根（默认当前目录）
# 说明：此脚本只清理本地运行垃圾和旧缓存，不删除 Ubuntu 部署脚本/配置。

param(
    [string]$Target = (Get-Location).Path,
    [switch]$Apply,
    [switch]$PruneBackups,
    [switch]$RemoveRuntimeLogs,
    [switch]$RemoveBuildArtifacts,
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

# ── 1) 运行日志（服务运行时默认保留）──
# 注：不动 *.pid —— stop.ps1 靠它找进程。建议先 stop.bat 再删当前日志。
if ($RemoveRuntimeLogs) {
    foreach ($name in @(
        "backend_out.log","backend_err.log",
        "forward.log","forward_out.log","forward_err.log",
        "startup.log",
        "health_check_report.txt"
    )) {
        Add-Target -Path (Join-Path $Root $name) -Reason "运行时日志（显式要求删除）"
    }
}

# ── 2) Python 缓存（仅项目代码目录，不动依赖目录里的）──
$DepDirs = @(".venv", ".venv-win", ".venv-linux", "venv", ".pydeps", "node_modules")
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

# ── 5) 旧 db 备份（默认保留，显式要求时才裁剪）──
if ($PruneBackups) {
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
}

# ── 6) 前端构建产物（当前后端会从这里托管页面，默认保留）──
if ($RemoveBuildArtifacts) {
    $Dist = Join-Path $Root "frontend\dist"
    if (Test-Path $Dist) {
        Add-Target -Path $Dist -Reason "前端 dist（显式要求删除构建产物）"
    }
}

# ── 7) 旧日志轮转文件（.old）──
Get-ChildItem -LiteralPath $Root -File -Filter "*.old" -ErrorAction SilentlyContinue |
    ForEach-Object { Add-Target -Path $_.FullName -Reason "旧日志轮转文件" }

# ── 8) Windows/J1900 遗留守护脚本（已废弃；Ubuntu 服务器用 systemd，不需要）──
foreach ($name in @(
    "watchdog.ps1",
    "install-watchdog.ps1",
    "uninstall-watchdog.ps1"
)) {
    Add-Target -Path (Join-Path $Root $name) -Reason "Windows 看门狗脚本（Ubuntu systemd 已替代）"
}

# ── 9) 迁移残留（跑完回填脚本后就不需要了）──
foreach ($name in @(
    "MIGRATE_REGION.md",
    "migrate_backfill.py",
    "fix_schema.py",
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
