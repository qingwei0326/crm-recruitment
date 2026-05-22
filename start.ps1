$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:CRM_PYTHON) {
    $Python = $env:CRM_PYTHON
} else {
    $VenvPython = Join-Path $Root ".venv-win\Scripts\python.exe"
    if (Test-Path $VenvPython) {
        $Python = $VenvPython
    } else {
        $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $PythonCommand) {
            throw "Python interpreter not found. Create .venv-win or set CRM_PYTHON to your Python path."
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
$env:CORS_ORIGINS = if ($env:CORS_ORIGINS) { $env:CORS_ORIGINS } else { "http://127.0.0.1:8000,http://localhost:8000,https://crm.qing-wei.com" }
# 通过 Cloudflare Tunnel 接入，必须信任代理头才能拿到真实 IP（限流/审计才正确）
if (-not $env:TRUST_PROXY_HEADERS) { $env:TRUST_PROXY_HEADERS = "1" }
# 仅经 https://crm.qing-wei.com 暴露，cookie 走 HTTPS 才有效
if (-not $env:COOKIE_SECURE) { $env:COOKIE_SECURE = "1" }

# Load .env if exists
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

Set-Location $Root

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NpmCandidates = @()
if ($NodeCommand) {
    $NodeRoot = Split-Path -Parent $NodeCommand.Source
    $NpmCandidates += @((Join-Path $NodeRoot "npm.cmd"), (Join-Path $NodeRoot "npm"))
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

# 日志轮转：旧进程已经停了，这是唯一能安全改 *.log 的时机
$MaxLogSize = 5MB
Get-ChildItem -Path $Root -Filter "*.log" -File -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Length -gt $MaxLogSize) {
        $OldPath = "$($_.FullName).old"
        if (Test-Path $OldPath) { Remove-Item $OldPath -Force -ErrorAction SilentlyContinue }
        Move-Item -LiteralPath $_.FullName -Destination $OldPath -Force -ErrorAction SilentlyContinue
        Write-Host "Rotated log: $($_.Name) -> $($_.Name).old"
    }
}
# 顺手清理 30 天前的 .log.old
$Cutoff = (Get-Date).AddDays(-30)
Get-ChildItem -Path $Root -Filter "*.log.old" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $Cutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Starting crm-backend hidden..."
$Backend = Start-Process `
    -FilePath $Python `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--log-config", "logging.json") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "backend_stdout.log") `
    -RedirectStandardError (Join-Path $Root "backend_stderr.log") `
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
Write-Host "Public (via Cloudflare Tunnel): https://crm.qing-wei.com"
