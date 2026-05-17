$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = "AdmissionsCRM"
$Script = Join-Path $Root "start.ps1"
$LogFile = Join-Path $Root "startup.log"

if (-not (Test-Path $Script)) {
    throw "start.ps1 not found: $Script"
}

$Python = $env:CRM_PYTHON
if (-not $Python) {
    $Python = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*Python312*" } |
        Select-Object -ExpandProperty FullName -First 1
}
if ($Python) {
    [Environment]::SetEnvironmentVariable("CRM_PYTHON", $Python, "User")
}

$Argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"Set-Location '$Root'; . '$Script' *> '$LogFile'`""

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $Argument `
    -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Start Admissions CRM via PM2 at user logon." `
    -Force | Out-Null

Write-Host "Startup task installed: $TaskName"
if ($Python) {
    Write-Host "CRM_PYTHON: $Python"
}
Write-Host "It will run at next user logon."
