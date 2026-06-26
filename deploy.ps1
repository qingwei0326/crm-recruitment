# deploy.ps1 - CRM deployment script
# Usage: .\deploy.ps1            # Full deploy
#        .\deploy.ps1 -NoBuild   # Skip frontend build
#        .\deploy.ps1 -DryRun    # Check environment only

param(
    [switch]$NoBuild,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
trap { Write-Host "`n[FAIL] $_" -ForegroundColor Red; Write-Host "Press any key to exit..." -ForegroundColor DarkGray; $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") }
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`n=== CRM Deploy v1.1 ===" -ForegroundColor Cyan

# 1. Check Python
$Python = $null
if ($env:CRM_PYTHON) {
    $Python = $env:CRM_PYTHON
} else {
    $VenvPython = Join-Path $Root ".venv-win\Scripts\python.exe"
    if (Test-Path $VenvPython) {
        $Python = $VenvPython
    } else {
        $PyCmd = Get-Command python -ErrorAction SilentlyContinue
        if ($PyCmd) { $Python = $PyCmd.Source }
    }
}
if (-not $Python -or -not (Test-Path $Python)) {
    Write-Host "[FAIL] Python not found. Install Python 3.11+ or set CRM_PYTHON." -ForegroundColor Red
    exit 1
}
$PyVer = & $Python --version 2>&1
Write-Host "[OK] Python: $PyVer ($Python)" -ForegroundColor Green

# 2. Check Node (only if building frontend)
$NpmCommand = $null
if (-not $NoBuild) {
    $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($NodeCmd) {
        $NodeRoot = Split-Path -Parent $NodeCmd.Source
        $NpmCandidates = @((Join-Path $NodeRoot "npm.cmd"), (Join-Path $NodeRoot "npm"))
        $NpmCandidates += @(
            (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
            (Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd"),
            (Join-Path $env:APPDATA "npm\npm.cmd")
        )
        $NpmCommand = $NpmCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    }
    if (-not $NpmCommand) {
        Write-Host "[WARN] Node.js/npm not found, skip frontend build." -ForegroundColor Yellow
        $NoBuild = $true
    } else {
        $NodeVer = & node --version 2>&1
        Write-Host "[OK] Node: $NodeVer" -ForegroundColor Green
    }
}

# 3. Check .env / SECRET_KEY
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.+)\s*$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim()
            if ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable($k))) {
                [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
            }
        }
    }
}
$SecretFile = Join-Path $Root ".secret_key"
if (-not $env:SECRET_KEY -and (Test-Path $SecretFile)) {
    $env:SECRET_KEY = (Get-Content -Raw -Encoding UTF8 $SecretFile).Trim()
}
if (-not $env:SECRET_KEY) {
    Write-Host "[FAIL] SECRET_KEY not set and .secret_key not found." -ForegroundColor Red
    Write-Host "  Add SECRET_KEY=xxx to .env or create .secret_key file." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] SECRET_KEY configured" -ForegroundColor Green

# 4. Backup database
$DbPath = Join-Path $Root "crm.db"
if (Test-Path $DbPath) {
    $BackupDir = Join-Path $Root "backups"
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
    $Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $BackupFile = Join-Path $BackupDir "crm_$Timestamp.db"
    Copy-Item -LiteralPath $DbPath -Destination $BackupFile -Force
    Write-Host "[OK] DB backed up: backups\crm_$Timestamp.db" -ForegroundColor Green
} else {
    Write-Host "[INFO] No DB file, will create on first start." -ForegroundColor Yellow
}

if ($DryRun) {
    Write-Host "`n=== DryRun complete ===" -ForegroundColor Cyan
    exit 0
}

# 5. Stop old backend
$BackendPidFile = Join-Path $Root "backend.pid"
$ForwardPidFile = Join-Path $Root "forward.pid"
$ExpectedNames = @("python", "python.exe", "pythonw", "pythonw.exe", "node", "node.exe", "uvicorn")
foreach ($PidFile in @($BackendPidFile, $ForwardPidFile)) {
    if (Test-Path $PidFile) {
        $OldPid = (Get-Content -Raw $PidFile).Trim()
        if ($OldPid) {
            $Proc = Get-Process -Id ([int]$OldPid) -ErrorAction SilentlyContinue
            if ($Proc -and ($ExpectedNames -contains $Proc.ProcessName -or $ExpectedNames -contains "$($Proc.ProcessName).exe")) {
                Write-Host "[STOP] Stopping: $($Proc.ProcessName) (PID $OldPid)" -ForegroundColor Yellow
                Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 1
            }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
}

# 6. Install Python deps
$PyDeps = Join-Path $Root ".pydeps"
if (Test-Path $PyDeps) {
    Write-Host "`n[SKIP] .pydeps exists, skip pip install" -ForegroundColor Yellow
} else {
    Write-Host "`n--- Installing Python deps ---" -ForegroundColor Cyan
    & $Python -m pip install -r (Join-Path $Root "requirements.txt") --quiet 2>&1 | ForEach-Object {
        if ($_ -match "Successfully installed") { Write-Host "[OK] $_" -ForegroundColor Green }
        elseif ($_ -match "already satisfied") { }
        elseif ($_ -match "ERROR") { Write-Host "[WARN] $_" -ForegroundColor Yellow }
    }
    Write-Host "[OK] Python deps installed" -ForegroundColor Green
}

# 7. Build frontend
if (-not $NoBuild) {
    Write-Host "`n--- Building frontend ---" -ForegroundColor Cyan
    $FrontendRoot = Join-Path $Root "frontend"
    Push-Location $FrontendRoot
    try {
        if (-not (Test-Path (Join-Path $FrontendRoot "node_modules"))) {
            Write-Host "  Installing npm deps..."
            & $NpmCommand install --silent 2>&1 | Out-Null
        }
        $LocalVite = Join-Path $FrontendRoot "node_modules\.bin\vite.cmd"
        if (Test-Path $LocalVite) {
            & $LocalVite build
        } else {
            & $NpmCommand run build
        }
        Write-Host "[OK] Frontend built" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] Frontend build failed: $_" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
} else {
    Write-Host "`n[SKIP] Frontend build skipped" -ForegroundColor Yellow
}

# 8. Start backend
Write-Host "`n--- Starting backend ---" -ForegroundColor Cyan
$env:DATABASE_PATH = Join-Path $Root "crm.db"
$env:FRONTEND_DIR = Join-Path $Root "frontend\dist"
$env:PYTHONNOUSERSITE = "1"
$PyDepsPath = Join-Path $Root ".pydeps"
if (Test-Path $PyDepsPath) {
    $env:PYTHONPATH = if ($env:PYTHONPATH) { "$PyDepsPath;$env:PYTHONPATH" } else { $PyDepsPath }
}
if (-not $env:CORS_ORIGINS) { $env:CORS_ORIGINS = "http://127.0.0.1:8000,http://localhost:8000,https://crm.qing-wei.com" }
if (-not $env:TRUST_PROXY_HEADERS) { $env:TRUST_PROXY_HEADERS = "1" }
if (-not $env:COOKIE_SECURE) { $env:COOKIE_SECURE = "1" }

$Backend = Start-Process `
    -FilePath $Python `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--log-config", "logging.json") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "backend_stdout.log") `
    -RedirectStandardError (Join-Path $Root "backend_stderr.log") `
    -PassThru
Set-Content -Path $BackendPidFile -Value $Backend.Id -Encoding ASCII
Write-Host "[OK] Backend started (PID $($Backend.Id))" -ForegroundColor Green

# Start LAN forward (if Node available)
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCommand) {
    $Forward = Start-Process `
        -FilePath $NodeCommand.Source `
        -ArgumentList @((Join-Path $Root "forward.js")) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Root "forward_out.log") `
        -RedirectStandardError (Join-Path $Root "forward_err.log") `
        -PassThru
    Set-Content -Path $ForwardPidFile -Value $Forward.Id -Encoding ASCII
    Write-Host "[OK] LAN forward started (PID $($Forward.Id))" -ForegroundColor Green
}

# 9. Verify
Write-Host "`n--- Verifying ---" -ForegroundColor Cyan
Start-Sleep -Seconds 3
try {
    $Response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/students?page_size=1" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($Response.StatusCode -eq 200) {
        Write-Host "[OK] API OK (HTTP $($Response.StatusCode))" -ForegroundColor Green
    } else {
        Write-Host "[WARN] API returned HTTP $($Response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[WARN] API not ready yet, initializing... ($_)" -ForegroundColor Yellow
    Write-Host "  Visit https://crm.qing-wei.com to verify." -ForegroundColor Yellow
}

Write-Host "`n=== Deploy complete ===" -ForegroundColor Cyan
Write-Host "  Local:  http://127.0.0.1:8000"
Write-Host "  Public: https://crm.qing-wei.com"
Write-Host "  Log:    backend_stderr.log"
Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
