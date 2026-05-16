$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFiles = @(
    (Join-Path $Root "backend.pid"),
    (Join-Path $Root "forward.pid")
)

foreach ($PidFile in $PidFiles) {
    if (Test-Path $PidFile) {
        $PidValue = (Get-Content -Raw $PidFile).Trim()
        if ($PidValue) {
            Stop-Process -Id ([int]$PidValue) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
}

$LocalPm2 = Join-Path $Root "node_modules\.bin\pm2.cmd"
if (Test-Path $LocalPm2) {
    & $LocalPm2 stop crm-backend crm-lan-forward *> $null
}

$UvicornProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like "*uvicorn app.main:app*" -and $_.ProcessId -ne $PID
}
foreach ($Process in $UvicornProcesses) {
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
}
