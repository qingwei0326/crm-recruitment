$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Pm2Command = Get-Command pm2 -ErrorAction SilentlyContinue
$LocalPm2 = Join-Path $Root "node_modules\.bin\pm2.cmd"
if ($Pm2Command) {
    $Pm2 = $Pm2Command.Source
} elseif (Test-Path $LocalPm2) {
    $Pm2 = $LocalPm2
} else {
    throw "pm2 not found. Run npm install in the project root or install PM2 globally."
}

& $Pm2 stop crm-backend
