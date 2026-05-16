$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:CRM_PYTHON) {
    $Python = $env:CRM_PYTHON
} else {
    $PythonCandidates = @(
        (Join-Path $Root ".venv-win\Scripts\python.exe"),
        (Join-Path $Root "venv\Scripts\python.exe")
    )

    $Python = $PythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $Python) {
        $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $PythonCommand) {
            throw "Python interpreter not found. Create .venv-win/venv or set CRM_PYTHON to your Python path."
        }
        $Python = $PythonCommand.Source
    }
}

$PythonCommand = Get-Command $Python -ErrorAction SilentlyContinue
if (-not $PythonCommand) {
    throw "Python interpreter not found: $Python. Create .venv-win or set CRM_PYTHON to your Python path."
}
$Python = $PythonCommand.Source
$PythonW = Join-Path (Split-Path -Parent $Python) "pythonw.exe"
if (Test-Path $PythonW) {
    $Python = $PythonW
} else {
    $LibreOfficePythonW = Get-ChildItem -Path (Join-Path (Split-Path -Parent $Python) "python-core-*\bin\pythonw.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($LibreOfficePythonW) {
        $Python = $LibreOfficePythonW.FullName
    }
}

$PyDeps = Join-Path $Root ".pydeps"
if (Test-Path $PyDeps) {
    $env:PYTHONNOUSERSITE = "1"
    $env:PYTHONPATH = if ($env:PYTHONPATH) { "$PyDeps;$env:PYTHONPATH" } else { $PyDeps }
}

$NpmGlobal = Join-Path $env:APPDATA "npm"
if ((Test-Path $NpmGlobal) -and ($env:PATH -notlike "*$NpmGlobal*")) {
    $env:PATH = "$NpmGlobal;$env:PATH"
}

$LocalPm2 = Join-Path $Root "node_modules\.bin\pm2.cmd"
if (Test-Path $LocalPm2) {
    $Pm2 = $LocalPm2
} else {
    $Pm2Command = Get-Command pm2 -ErrorAction SilentlyContinue
    if ($Pm2Command) {
        $Pm2 = $Pm2Command.Source
    }
}
if (-not $Pm2) {
    throw "pm2 not found. Run npm install in the project root or install PM2 globally."
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
& $Pm2 start ecosystem.config.js --update-env
& $Pm2 save

Write-Host "Ready: http://127.0.0.1:8000"
Write-Host "LAN:   http://192.168.8.2:8000"
