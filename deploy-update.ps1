param(
    [string]$Target = "D:\CRM",
    [switch]$SkipStop,
    [switch]$SkipStart
)

$ErrorActionPreference = "Stop"

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceFull = [System.IO.Path]::GetFullPath($Source).TrimEnd("\")
$TargetFull = [System.IO.Path]::GetFullPath($Target).TrimEnd("\")

if ($SourceFull -ieq $TargetFull) {
    throw "Deploy source and target are the same directory. Run this script from an unpacked release folder, not from $TargetFull."
}

if (-not (Test-Path $SourceFull)) {
    throw "Source folder not found: $SourceFull"
}

if (-not (Test-Path $TargetFull)) {
    New-Item -ItemType Directory -Path $TargetFull -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $TargetFull "backups\before-update-$Timestamp"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

Write-Host "Target: $TargetFull"
Write-Host "Backup: $BackupDir"

$PreserveFiles = @(
    "crm.db",
    ".secret_key",
    ".env"
)

foreach ($Name in $PreserveFiles) {
    $Path = Join-Path $TargetFull $Name
    if (Test-Path $Path) {
        Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupDir $Name) -Force
    }
}

if (-not $SkipStop) {
    $StopScript = Join-Path $TargetFull "stop.ps1"
    if (Test-Path $StopScript) {
        Write-Host "Stopping existing service..."
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $StopScript
        } catch {
            Write-Warning "Stop script failed, continuing with deployment: $($_.Exception.Message)"
        }
    }
}

$ExcludeDirs = @(
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".venv-win",
    "venv",
    "__pycache__",
    "backups",
    "releases"
)

$ExcludeFiles = @(
    "crm.db",
    ".secret_key",
    ".env",
    "backend.pid",
    "forward.pid",
    "backend_out.log",
    "backend_err.log",
    "forward.log",
    "forward_out.log",
    "forward_err.log",
    "startup.log"
)

function Test-ExcludedPath {
    param([string]$RelativePath)

    $parts = $RelativePath -split '[\\/]'
    foreach ($part in $parts) {
        if ($ExcludeDirs -contains $part) {
            return $true
        }
    }

    $name = Split-Path $RelativePath -Leaf
    if ($ExcludeFiles -contains $name) {
        return $true
    }

    if ($name -like "*.log" -or $name -like "*.pid" -or $name -like "*.db") {
        return $true
    }

    return $false
}

Write-Host "Copying release files..."
$Files = Get-ChildItem -Path $SourceFull -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $relative = $_.FullName.Substring($SourceFull.Length).TrimStart("\")
    -not (Test-ExcludedPath $relative)
} | Sort-Object FullName

foreach ($File in $Files) {
    $relative = $File.FullName.Substring($SourceFull.Length).TrimStart("\")
    $dest = Join-Path $TargetFull $relative
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $File.FullName -Destination $dest -Force
}

foreach ($Name in $PreserveFiles) {
    $BackupPath = Join-Path $BackupDir $Name
    $TargetPath = Join-Path $TargetFull $Name
    if ((Test-Path $BackupPath) -and -not (Test-Path $TargetPath)) {
        Copy-Item -LiteralPath $BackupPath -Destination $TargetPath -Force
    }
}

$RequiredForStart = @(".secret_key")
$MissingRequired = @()
foreach ($Name in $RequiredForStart) {
    $TargetPath = Join-Path $TargetFull $Name
    if (-not (Test-Path $TargetPath)) {
        $MissingRequired += $Name
    }
}

if ($MissingRequired.Count -gt 0) {
    throw "Deployment copied code, but required runtime files are missing in target: $($MissingRequired -join ', '). Copy them into $TargetFull and rerun deploy-update.cmd."
}

if (-not $SkipStart) {
    $InitDbScript = Join-Path $TargetFull "init_db.py"
    if (Test-Path $InitDbScript) {
        Write-Host "Running database migrations (init_db.py)..."
        $PyExe = $env:CRM_PYTHON
        if (-not $PyExe -or -not (Test-Path $PyExe)) {
            $LocalVenv = Join-Path $TargetFull ".venv-win\Scripts\python.exe"
            if (Test-Path $LocalVenv) {
                $PyExe = $LocalVenv
            } else {
                $PyExe = "python"
            }
        }
        Push-Location $TargetFull
        try {
            & $PyExe init_db.py
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "init_db.py exited with code $LASTEXITCODE. Check the output above before starting the service."
            }
        } catch {
            Write-Warning "init_db.py failed: $($_.Exception.Message). Continuing to start, but new columns/tables may be missing."
        } finally {
            Pop-Location
        }
    }

    $StartScript = Join-Path $TargetFull "start.ps1"
    if (-not (Test-Path $StartScript)) {
        throw "start.ps1 not found after deployment: $StartScript"
    }

    Write-Host "Starting service..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File $StartScript
}

Write-Host "Deployment complete."
Write-Host "Open: http://127.0.0.1:8000"

