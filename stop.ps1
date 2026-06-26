$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Root "scripts\process-control.ps1")
$PidFiles = @(
    (Join-Path $Root "backend.pid"),
    (Join-Path $Root "forward.pid")
)
Stop-CrmProcesses -Root $Root -PidFiles $PidFiles
Assert-CrmPortAvailable -Root $Root
Write-Host "Stopped CRM backend and LAN forward processes."
