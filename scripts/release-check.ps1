# Admissions CRM release readiness check.
#
# This script is intentionally non-destructive. It runs the same checks that
# should pass before packaging or deploying a release, then prints a compact
# worktree/runtime summary for manual review.

param(
    [switch]$SkipBackendTests,
    [switch]$SkipFrontendTests,
    [switch]$SkipLint,
    [switch]$SkipBuild,
    [switch]$SkipHealth,
    [string]$HealthUrl = "http://127.0.0.1:8000/api/health",
    [string]$ProductionReleaseDir = ""
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Failures = New-Object System.Collections.Generic.List[string]
$Results = New-Object System.Collections.Generic.List[object]

function Invoke-ReleaseStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    $started = Get-Date
    try {
        & $Command
        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        $script:Results.Add([pscustomobject]@{
            Step = $Name
            Status = "PASS"
            Seconds = $elapsed
        }) | Out-Null
        Write-Host "PASS: $Name ($elapsed s)" -ForegroundColor Green
    } catch {
        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        $message = $_.Exception.Message
        $script:Failures.Add("$Name - $message") | Out-Null
        $script:Results.Add([pscustomobject]@{
            Step = $Name
            Status = "FAIL"
            Seconds = $elapsed
        }) | Out-Null
        Write-Host "FAIL: $Name ($elapsed s)" -ForegroundColor Red
        Write-Host $message -ForegroundColor Red
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath $($Arguments -join ' ') exited with code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Assert-PathExists {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $path = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required path missing: $RelativePath"
    }
}

function Assert-PathMissing {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $path = Join-Path $Root $RelativePath
    if (Test-Path -LiteralPath $path) {
        throw "Retired path still exists: $RelativePath"
    }
}

function Get-PowerShellArrayItems {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $pattern = "(?s)\$" + [regex]::Escape($Name) + "\s*=\s*@\((.*?)\)"
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) {
        throw "Could not find array `$$Name"
    }

    return @([regex]::Matches($match.Groups[1].Value, '"([^"]+)"') | ForEach-Object {
        $_.Groups[1].Value
    })
}

function Assert-ReleasePackagePolicy {
    $makeReleasePath = Join-Path $Root "make-release.ps1"
    Assert-PathExists "make-release.ps1"
    $makeRelease = Get-Content -LiteralPath $makeReleasePath -Raw
    $excludeFiles = Get-PowerShellArrayItems -Text $makeRelease -Name "ExcludeFiles"
    $excludeDirs = Get-PowerShellArrayItems -Text $makeRelease -Name "ExcludeDirs"

    foreach ($script in @(
        "scripts\prepare-production-release.ps1",
        "scripts\sqlite_online_backup.py",
        "scripts\verify_production_release.py"
    )) {
        Assert-PathExists $script
    }

    $includedScripts = @("make-release.ps1", "make-release.cmd")
    foreach ($script in $includedScripts) {
        Assert-PathExists $script
        if ($excludeFiles -contains $script) {
            throw "Generic start/deploy script must stay in release package: $script"
        }
    }

    $excludedFiles = @(
        ".env",
        ".env.linux",
        ".secret_key",
        ".mcp.json",
        "crm.db",
        "backend.pid",
        "forward.pid",
        "backend_stdout.log",
        "backend_stderr.log",
        "backend_out.log",
        "backend_err.log",
        "forward.log",
        "forward_out.log",
        "forward_err.log",
        "startup.log",
        "watchdog.ps1",
        "install-watchdog.ps1",
        "uninstall-watchdog.ps1",
        "install-tunnel-task.ps1",
        "start-tunnel.bat",
        "cloudflared-config.yml",
        "nginx-crm.conf",
        "forward.js",
        "frpc.ini",
        "tunnel.sh"
    )
    foreach ($file in $excludedFiles) {
        if ($excludeFiles -notcontains $file) {
            throw "Release package must exclude runtime/local file: $file"
        }
    }

    foreach ($dir in @("archive", "backups", "data", "releases", "tests")) {
        if ($excludeDirs -notcontains $dir) {
            throw "Release package must exclude directory: $dir"
        }
    }

    foreach ($pattern in @('*.log*', '*.pid', '*.db')) {
        if ($makeRelease -notmatch [regex]::Escape($pattern)) {
            throw "Release package wildcard exclusion missing: $pattern"
        }
    }
}

function Assert-RetiredWatchdog {
    foreach ($file in @("watchdog.ps1", "install-watchdog.ps1", "uninstall-watchdog.ps1")) {
        Assert-PathMissing $file
    }

    $checklistPath = Join-Path $Root "RELEASE-CHECKLIST.md"
    Assert-PathExists "RELEASE-CHECKLIST.md"
    $checklist = Get-Content -LiteralPath $checklistPath -Raw
    if ($checklist -notmatch "watchdog" -or $checklist -notmatch "废弃") {
        throw "RELEASE-CHECKLIST.md must document that watchdog is deprecated"
    }
}

function Assert-RetiredPredictionApi {
    $files = @()
    foreach ($dir in @("app", "frontend\src")) {
        $path = Join-Path $Root $dir
        if (Test-Path -LiteralPath $path) {
            $files += Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue
        }
    }

    $patterns = @(
        '@router\.(get|post|put|delete)\(\s*["'']\/predictions["'']',
        '["'']\/stats\/predictions["'']',
        '["'']\/api\/stats\/predictions["'']'
    )

    foreach ($file in $files) {
        $text = Get-Content -LiteralPath $file.FullName -Raw
        foreach ($pattern in $patterns) {
            if ($text -match $pattern) {
                $relative = $file.FullName.Substring($Root.Length).TrimStart("\")
                throw "Deprecated predictions API reference found in ${relative}: $pattern"
            }
        }
    }
}

Write-Host "Release readiness check" -ForegroundColor Cyan
Write-Host "Root: $Root"

Invoke-ReleaseStep -Name "P0 release package policy" -Command {
    Assert-ReleasePackagePolicy
}

Invoke-ReleaseStep -Name "P0 retired watchdog scripts" -Command {
    Assert-RetiredWatchdog
}

Invoke-ReleaseStep -Name "P0 retired predictions API" -Command {
    Assert-RetiredPredictionApi
}

function Get-ProjectPython {
    $isWindowsHost = $env:OS -eq "Windows_NT"
    $candidates = if ($isWindowsHost) {
        @(
            (Join-Path $Root ".venv-win\Scripts\python.exe"),
            (Join-Path $Root ".venv\Scripts\python.exe")
        )
    } else {
        @(
            (Join-Path $Root ".venv-py312\bin\python"),
            (Join-Path $Root ".venv\bin\python")
        )
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            try {
                & $candidate -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
                if ($LASTEXITCODE -eq 0) {
                    return $candidate
                }
            } catch {
                continue
            }
        }
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        & $python.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
        if ($LASTEXITCODE -eq 0) {
            return $python.Source
        }
    }

    throw "Python interpreter not found. Create a project virtual environment before release checks."
}

if (-not [string]::IsNullOrWhiteSpace($ProductionReleaseDir)) {
    Invoke-ReleaseStep -Name "Production release package" -Command {
        $python = Get-ProjectPython
        $releasePath = [System.IO.Path]::GetFullPath($ProductionReleaseDir)
        Invoke-CheckedCommand -FilePath $python -Arguments @(
            "scripts/verify_production_release.py",
            $releasePath
        ) -WorkingDirectory $Root
    }
}

if (-not [string]::IsNullOrWhiteSpace($env:DOMAIN_AUDIT_DATABASE)) {
    Invoke-ReleaseStep -Name "Domain consistency audit" -Command {
        $python = Get-ProjectPython
        Invoke-CheckedCommand -FilePath $python -Arguments @(
            "scripts/audit_domain_consistency.py",
            "--database",
            $env:DOMAIN_AUDIT_DATABASE,
            "--expect-revision",
            "20260925_01"
        ) -WorkingDirectory $Root
    }

    # P0 数据库迁移门禁（v2.0 Phase 0-4）：落后库先自愈升级到 head，再校验无漂移。
    # 这样携带「落后一个迁移导致报名/财务接口 500」的库在发布前会被自动修复，而非带着故障上线。
    Invoke-ReleaseStep -Name "P0 database migration gate (alembic head + check)" -Command {
        $python = Get-ProjectPython
        Invoke-CheckedCommand -FilePath $python -Arguments @("-m", "alembic", "upgrade", "head") -WorkingDirectory $Root
        Invoke-CheckedCommand -FilePath $python -Arguments @("-m", "alembic", "check") -WorkingDirectory $Root
    }
}


if (-not $SkipBackendTests) {
    Invoke-ReleaseStep -Name "Backend tests" -Command {
        $python = Get-ProjectPython
        Write-Host "Python: $python"
        Invoke-CheckedCommand -FilePath $python -Arguments @("-m", "pytest", "-q") -WorkingDirectory $Root
    }
}

if (-not $SkipFrontendTests) {
    Invoke-ReleaseStep -Name "Frontend tests" -Command {
        Invoke-CheckedCommand -FilePath "npm" -Arguments @("test") -WorkingDirectory (Join-Path $Root "frontend")
    }
}

if (-not $SkipLint) {
    Invoke-ReleaseStep -Name "Frontend lint" -Command {
        Invoke-CheckedCommand -FilePath "npm" -Arguments @("run", "lint") -WorkingDirectory (Join-Path $Root "frontend")
    }
}

if (-not $SkipBuild) {
    Invoke-ReleaseStep -Name "Frontend build" -Command {
        Invoke-CheckedCommand -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory (Join-Path $Root "frontend")
    }
}

if (-not $SkipHealth) {
    Invoke-ReleaseStep -Name "Runtime health" -Command {
        $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 10
        $isHealthy =
            $health.status -eq "ok" -or
            ($health.code -eq 0 -and $health.msg -eq "ok" -and $health.db -eq "ok")
        if (-not $isHealthy) {
            throw "Unexpected health status: $($health | ConvertTo-Json -Compress)"
        }
        Write-Host ($health | ConvertTo-Json -Compress)
    }
}

Write-Host ""
Write-Host "==> Worktree summary" -ForegroundColor Cyan
Push-Location $Root
try {
    $statusLines = @(git status --short)
    if ($LASTEXITCODE -ne 0) {
        throw "git status exited with code $LASTEXITCODE"
    }

    if ($statusLines.Count -eq 0) {
        Write-Host "Worktree: clean" -ForegroundColor Green
    } else {
        Write-Host "Worktree: $($statusLines.Count) changed paths need review before release" -ForegroundColor Yellow
        $statusLines | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" }
        if ($statusLines.Count -gt 40) {
            Write-Host "  ... $($statusLines.Count - 40) more"
        }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "==> Summary" -ForegroundColor Cyan
$Results | Format-Table -AutoSize

if ($Failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Release check failed:" -ForegroundColor Red
    $Failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "All release checks passed." -ForegroundColor Green
