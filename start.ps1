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

$PyDeps = Join-Path $Root ".pydeps"
if (Test-Path $PyDeps) {
    $env:PYTHONNOUSERSITE = "1"
    $env:PYTHONPATH = if ($env:PYTHONPATH) { "$PyDeps;$env:PYTHONPATH" } else { $PyDeps }
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

if (-not $env:SECRET_KEY) {
    $SecretFile = Join-Path $Root ".secret_key"
    if (Test-Path $SecretFile) {
        $env:SECRET_KEY = (Get-Content -Raw -Encoding UTF8 $SecretFile).Trim()
    }
}

if (-not $env:SECRET_KEY) {
    throw "SECRET_KEY is not set and .secret_key was not found."
}

$env:DATABASE_PATH = Join-Path $Root "crm.db"
$env:FRONTEND_DIR = Join-Path $Root "frontend\dist"
$env:PYTHONNOUSERSITE = "1"
$env:CORS_ORIGINS = if ($env:CORS_ORIGINS) { $env:CORS_ORIGINS } else { "http://127.0.0.1:8000,http://localhost:8000,http://192.168.8.2:8000" }

Set-Location $Root

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NpmCandidates = @()
if ($NodeCommand) {
    $NodeRoot = Split-Path -Parent $NodeCommand.Source
    $NpmCandidates += @(Join-Path $NodeRoot "npm.cmd", (Join-Path $NodeRoot "npm"))
}
$NpmCandidates += @(
    (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd"),
    (Join-Path $env:APPDATA "npm\npm.cmd")
)
$NpmCommand = $NpmCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $NpmCommand) {
    $NpmCommand = (Get-Command npm -ErrorAction SilentlyContinue).Source
}

Write-Host "Building frontend..."
$FrontendRoot = Join-Path $Root "frontend"
Push-Location $FrontendRoot
try {
    $LocalVite = Join-Path $FrontendRoot "node_modules\.bin\vite.cmd"
    if (Test-Path $LocalVite) {
        & $LocalVite build
    } elseif ($NpmCommand) {
        & $NpmCommand run build
    } else {
        throw "Neither frontend\node_modules\.bin\vite.cmd nor npm was found. Install the official Node.js LTS Windows installer so node and npm are both available."
    }
} finally {
    Pop-Location
}

if ($Pm2) {
    try {
        & $Pm2 stop crm-backend crm-lan-forward *> $null
    } catch {
        Write-Warning "PM2 stop skipped: $($_.Exception.Message)"
    }
}

$BackendPidFile = Join-Path $Root "backend.pid"
$ForwardPidFile = Join-Path $Root "forward.pid"
foreach ($PidFile in @($BackendPidFile, $ForwardPidFile)) {
    if (Test-Path $PidFile) {
        $OldPid = (Get-Content -Raw $PidFile).Trim()
        if ($OldPid) {
            Stop-Process -Id ([int]$OldPid) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Starting crm-backend hidden..."
$Backend = Start-Process `
    -FilePath $Python `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "backend_out.log") `
    -RedirectStandardError (Join-Path $Root "backend_err.log") `
    -PassThru
Set-Content -Path $BackendPidFile -Value $Backend.Id -Encoding ASCII

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCommand) {
    Write-Host "Starting LAN forward hidden..."
    $Forward = Start-Process `
        -FilePath $NodeCommand.Source `
        -ArgumentList @((Join-Path $Root "forward.js")) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Root "forward_out.log") `
        -RedirectStandardError (Join-Path $Root "forward_err.log") `
        -PassThru
    Set-Content -Path $ForwardPidFile -Value $Forward.Id -Encoding ASCII
}

Write-Host "Ready: http://127.0.0.1:8000"
Write-Host "LAN:   http://192.168.8.2:8000"
