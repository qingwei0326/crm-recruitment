$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = if ($env:CRM_PYTHON) { $env:CRM_PYTHON } else { Join-Path $Root ".venv-win\Scripts\python.exe" }
$NpmGlobal = Join-Path $env:APPDATA "npm"
if ((Test-Path $NpmGlobal) -and ($env:PATH -notlike "*$NpmGlobal*")) {
    $env:PATH = "$NpmGlobal;$env:PATH"
}

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    throw "pm2 not found in PATH. Install PM2 or run this from a shell where pm2 is available."
}

if (-not (Test-Path $Python)) {
    throw "Python interpreter not found: $Python. Create .venv-win or set CRM_PYTHON to your Python path."
}

if (-not $env:SECRET_KEY) {
    $SecretFile = Join-Path $Root ".secret_key"
    if (Test-Path $SecretFile) {
        $env:SECRET_KEY = (Get-Content -Raw -Encoding UTF8 $SecretFile).Trim()
    }
}

if (-not $env:SECRET_KEY) {
    throw "SECRET_KEY is not set and .secret_key was not found."
}

$env:CRM_PYTHON = $Python
Set-Location $Root

Write-Host "Building frontend..."
Push-Location (Join-Path $Root "frontend")
npm run build
Pop-Location

Write-Host "Starting crm-backend with PM2..."
pm2 start ecosystem.config.js --update-env
pm2 save

Write-Host "Ready: http://127.0.0.1:8000"
