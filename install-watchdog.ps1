$ErrorActionPreference = "Stop"

# 注册“招生系统看门狗”计划任务：每 3 分钟检查一次后端，挂了自动拉起。
# 与 install-startup.ps1 同一套路：以当前登录用户身份运行，环境变量(CRM_PYTHON 等)都在。
# 右键 → 用 PowerShell 运行即可（不需要管理员）。

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = "AdmissionsCRM-Watchdog"
$Script = Join-Path $Root "watchdog.ps1"

if (-not (Test-Path $Script)) {
    throw "watchdog.ps1 not found: $Script"
}

$Argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`""

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $Argument `
    -WorkingDirectory $Root

# 触发器1：登录后立刻跑一次（开机自启拉服务期间，看门狗会自觉避让）
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn
# 触发器2：每 3 分钟重复一次，持续到很久以后（等于“一直每 3 分钟查一次”）
$RepeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 3) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger @($LogonTrigger, $RepeatTrigger) `
    -Settings $Settings `
    -Description "Watchdog: 每 3 分钟检查招生系统后端 /api/health，挂了自动拉起。" `
    -Force | Out-Null

Write-Host "看门狗任务已安装: $TaskName"
Write-Host "  - 登录后立刻检查一次"
Write-Host "  - 之后每 3 分钟检查一次 http://127.0.0.1:8000/api/health"
Write-Host "  - 后端崩了/卡死会自动调用 start.ps1 -NoBuild 拉起，动作记录在 watchdog.log"
Write-Host ""
Write-Host "想立刻测试：Start-ScheduledTask -TaskName '$TaskName'，然后看 watchdog.log"
