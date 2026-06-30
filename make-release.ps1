param(
    [string]$Version = (Get-Date -Format "yyyyMMdd-HHmmss"),
    [switch]$IncludeDeps,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseRoot = Join-Path $Root "releases"
$ReleaseName = "admissions-crm-$Version"
$ReleaseDir = Join-Path $ReleaseRoot $ReleaseName
$ZipPath = Join-Path $ReleaseRoot "$ReleaseName.zip"

$ExcludeDirs = @(
    ".git",
    ".github",
    ".agents",
    ".claude",
    ".codex",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".venv-win",
    ".venv-linux",
    "venv",
    "__pycache__",
    "__tests__",
    "backups",
    "data",
    "docs",
    "releases",
    "test-results",
    "tests"
)

if (-not $IncludeDeps) {
    $ExcludeDirs += @(".pydeps", "node_modules")
}

# Keep generic start/deploy scripts in the release package:
# start/stop, deploy/deploy-update/deploy-linux, make-release, and startup task helpers.
# Only retired watchdog scripts and machine-local runtime/tunnel config are excluded below.
$ExcludeFiles = @(
    "crm.db",
    ".secret_key",
    ".env",
    ".env.linux",
    ".mcp.json",
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
    "tunnel.sh",
    "project_all.txt",
    "project_review.txt",
    "project_review_bundle.txt",
    "crm.before-j1900-migration.db",
    "health_check_report.txt"
)

function Test-ExcludedPath {
    param([string]$RelativePath)

    $normalized = $RelativePath -replace '/', '\'
    if ($normalized -ieq "frontend\dist" -or $normalized -ilike "frontend\dist\*") {
        return $true
    }

    $parts = $RelativePath -split '[\\/]'
    foreach ($part in $parts) {
        if ($ExcludeDirs -contains $part) {
            return $true
        }
    }

    $name = Split-Path $RelativePath -Leaf
    if ($name -like "review-*") {
        return $true
    }

    if ($name -like ".codex-*.png") {
        return $true
    }

    if ($ExcludeFiles -contains $name) {
        return $true
    }

    if ($name -like "*.log*" -or $name -like "*.pid" -or $name -like "*.db") {
        return $true
    }

    if ($RelativePath -ilike "node_modules\.bin\.*" -or $RelativePath -ilike "frontend\node_modules\.bin\.*") {
        return $true
    }

    return $false
}

if (-not $SkipBuild) {
    Write-Host "Building frontend..."
    Push-Location (Join-Path $Root "frontend")
    try {
        npm run build
    } finally {
        Pop-Location
    }
}

if (Test-Path $ReleaseDir) {
    Remove-Item $ReleaseDir -Recurse -Force
}
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}

New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

Write-Host "Collecting release files..."
$Files = Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $relative = $_.FullName.Substring($Root.Length).TrimStart("\")
    -not (Test-ExcludedPath $relative)
} | Sort-Object FullName

foreach ($File in $Files) {
    $relative = $File.FullName.Substring($Root.Length).TrimStart("\")
    $dest = Join-Path $ReleaseDir $relative
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $File.FullName -Destination $dest -Force
}

$Manifest = [ordered]@{
    name = "admissions-crm"
    version = $Version
    created_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    include_deps = [bool]$IncludeDeps
    file_count = $Files.Count
    excluded_data = @("crm.db", ".secret_key", ".env", "backups", "*.log", "*.pid")
}

$Manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $ReleaseDir "release-manifest.json") -Encoding UTF8

Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $ZipPath -Force

Write-Host "Release folder: $ReleaseDir"
Write-Host "Release zip:    $ZipPath"
Write-Host "Files:          $($Files.Count)"
if (-not $IncludeDeps) {
    Write-Host "Deps:           excluded; target machine must already have .pydeps/node_modules or install deps."
} else {
    Write-Host "Deps:           included."
}
