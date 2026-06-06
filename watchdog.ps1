$ErrorActionPreference = "Stop"

# 招生系统看门狗：每隔几分钟由计划任务调用一次。
# 查 /api/health，挂了/卡死就调用 start.ps1 -NoBuild 把后端拉起来。
# 注意：这只能救“机器还活着、只是后端崩了/卡死”。整机真死机（系统僵住）时
# 计划任务本身都跑不起来，那种情况只能靠 BIOS 关 C-State / 来电自启 / 换机解决。

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path $Root "watchdog.log"
$HealthUrl = "http://127.0.0.1:8000/api/health"
$StartupTaskName = "AdmissionsCRM"

function Write-Log {
    param([string]$Text)
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# 日志超过 2MB 就轮转，别把 J1900 的盘写满
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 2MB)) {
    $old = "$LogFile.old"
    if (Test-Path $old) { Remove-Item $old -Force -ErrorAction SilentlyContinue }
    Move-Item -LiteralPath $LogFile -Destination $old -Force -ErrorAction SilentlyContinue
}

# 健康检查：HTTP 200 且返回体里有 "code":0 才算真活着（能捕获“进程在但卡死不响应”）
function Test-Health {
    try {
        $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 8
        return ($resp.StatusCode -eq 200 -and $resp.Content -match '"code"\s*:\s*0')
    } catch {
        return $false
    }
}

# 如果开机自启任务正在跑（登录后正在 build 前端拉服务），别插手，避免打架
try {
    $startupTask = Get-ScheduledTask -TaskName $StartupTaskName -ErrorAction SilentlyContinue
    if ($startupTask -and $startupTask.State -eq 'Running') {
        exit 0
    }
} catch { }

# 第一次检查
if (Test-Health) { exit 0 }

# 第一次失败，等 5 秒再确认一次，避开瞬时抖动（比如刚好在重启中途）
Start-Sleep -Seconds 5
if (Test-Health) { exit 0 }

# 连续两次都不健康 → 拉起后端
Write-Log "health check FAILED ($HealthUrl) — restarting backend via start.ps1 -NoBuild"
try {
    $startScript = Join-Path $Root "start.ps1"
    & $startScript -NoBuild *>> $LogFile
    Start-Sleep -Seconds 8
    if (Test-Health) {
        Write-Log "restart OK — backend healthy again"
    } else {
        Write-Log "restart attempted but health STILL failing — 可能是整机层面问题(过热/电源/磁盘)，建议跑 diag_shutdown.ps1 排查"
    }
} catch {
    Write-Log "restart ERROR: $($_.Exception.Message)"
}
