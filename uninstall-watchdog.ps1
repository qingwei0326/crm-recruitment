$ErrorActionPreference = "Stop"

$TaskName = "AdmissionsCRM-Watchdog"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "看门狗任务已移除: $TaskName"
} else {
    Write-Host "未找到看门狗任务: $TaskName"
}
