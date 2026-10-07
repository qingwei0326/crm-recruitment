param(
    [string]$Version = (Get-Date -Format "yyyyMMdd-HHmmss"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^[A-Za-z0-9._-]+$') {
    throw "Version may only contain letters, numbers, dots, underscores, and hyphens."
}

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ReleaseRoot = Join-Path $Root "releases"
$ReleaseName = "production-$Version"
$ReleaseDir = Join-Path $ReleaseRoot $ReleaseName
$ZipPath = Join-Path $ReleaseRoot "$ReleaseName.zip"
$ZipHashPath = "$ZipPath.sha256"
$DatabaseUpgradeFromRevision = "20260726_01"
$ExpectedDatabaseRevision = "20261007_01"

function Copy-ReleaseTree {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    Get-ChildItem -LiteralPath $Source -Recurse -File | Where-Object {
        $_.Extension -ne ".pyc" -and $_.FullName -notmatch '[\\/]__pycache__[\\/]'
    } | ForEach-Object {
        $relative = $_.FullName.Substring($Source.Length).TrimStart("\", "/")
        $target = Join-Path $Destination $relative
        $targetDir = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
}

function Copy-ReleaseFile {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $source = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required release file missing: $RelativePath"
    }
    $target = Join-Path $ReleaseDir $RelativePath
    $targetDir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
}

function Get-ProjectPython {
    $isWindowsHost = $IsWindows -or (
        [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
    )
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
            return $candidate
        }
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }
    throw "Python interpreter not found."
}

Push-Location (Join-Path $Root "frontend")
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

foreach ($requiredDir in @("app", "alembic", "frontend\dist")) {
    $path = Join-Path $Root $requiredDir
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "Required release directory missing: $requiredDir"
    }
}
foreach ($requiredFile in @(
    "alembic.ini",
    "alembic\env.py",
    "frontend\dist\index.html"
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $requiredFile) -PathType Leaf)) {
        throw "Required release file missing: $requiredFile"
    }
}
# 必需：恰好存在一个 head revision 对应的迁移文件（与 verify_production_release.py 的 glob 约定一致）
$headMigrations = @(
    Get-ChildItem -LiteralPath (Join-Path $Root "alembic\versions") `
        -Filter "${ExpectedDatabaseRevision}_*.py" -File -ErrorAction SilentlyContinue
)
if ($headMigrations.Count -ne 1) {
    throw "Release must contain exactly one Alembic migration for $ExpectedDatabaseRevision (found $($headMigrations.Count))"
}
$assetDir = Join-Path $Root "frontend\dist\assets"
if (-not (Get-ChildItem -LiteralPath $assetDir -Filter "*.js" -File -ErrorAction SilentlyContinue)) {
    throw "Frontend JavaScript assets are missing."
}
if (-not (Get-ChildItem -LiteralPath $assetDir -Filter "*.css" -File -ErrorAction SilentlyContinue)) {
    throw "Frontend CSS assets are missing."
}

New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
$existingPaths = @($ReleaseDir, $ZipPath, $ZipHashPath) | Where-Object {
    Test-Path -LiteralPath $_
}
if ($existingPaths -and -not $Force) {
    throw "Release version already exists. Use a new version or pass -Force explicitly: $Version"
}
if ($Force) {
    foreach ($path in $existingPaths) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

Copy-ReleaseTree -Source (Join-Path $Root "app") -Destination (Join-Path $ReleaseDir "app")
Copy-ReleaseTree -Source (Join-Path $Root "alembic") -Destination (Join-Path $ReleaseDir "alembic")
Copy-ReleaseTree -Source (Join-Path $Root "frontend\dist") -Destination (Join-Path $ReleaseDir "frontend\dist")
foreach ($file in @(
    "alembic.ini",
    "requirements.txt",
    "logging.json",
    "data\school_regions.json",
    "scripts\repair_work_item_owners.py",
    "scripts\sqlite_online_backup.py",
    "scripts\verify_production_release.py"
)) {
    Copy-ReleaseFile $file
}

$forbiddenFiles = Get-ChildItem -LiteralPath $ReleaseDir -Recurse -File | Where-Object {
    $_.Name -in @(".env", ".secret_key", "crm.db") -or
    $_.Name -like "*.db*" -or
    $_.Name -like "*.log*" -or
    $_.Name -like "*.pid*"
}
if ($forbiddenFiles) {
    $names = ($forbiddenFiles.FullName -join ", ")
    throw "Forbidden runtime data found in release: $names"
}

$entries = @(Get-ChildItem -LiteralPath $ReleaseDir -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($ReleaseDir.Length).TrimStart("\", "/").Replace("\", "/")
    [ordered]@{
        path = $relative
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
} | Sort-Object { $_.path })

$checksumPath = Join-Path $ReleaseDir "SHA256SUMS"
$checksumLines = $entries | ForEach-Object { "$($_.sha256)  $($_.path)" }
$checksumLines | Set-Content -LiteralPath $checksumPath -Encoding ascii
$aggregateHash = (Get-FileHash -LiteralPath $checksumPath -Algorithm SHA256).Hash.ToLowerInvariant()
$runtimeBytes = ($entries | ForEach-Object { [int64]$_.bytes } | Measure-Object -Sum).Sum

Push-Location $Root
try {
    $gitCommit = (git rev-parse HEAD).Trim()
    $gitBranch = (git branch --show-current).Trim()
    $runtimeStatus = @(git status --short -- app alembic alembic.ini frontend requirements.txt logging.json data/school_regions.json scripts/repair_work_item_owners.py scripts/sqlite_online_backup.py scripts/verify_production_release.py)
} finally {
    Pop-Location
}

$schemaGuardPaths = @(
    "app/config.py",
    "app/database.py",
    "app/domain_models.py",
    "app/legacy_schema_compat.py",
    "app/main.py",
    "app/migration_config.py",
    "app/models.py"
)
$schemaGuardFiles = @($entries | Where-Object { $_.path -in $schemaGuardPaths } | ForEach-Object {
    [ordered]@{ path = $_.path; sha256 = $_.sha256 }
})
$manifest = [ordered]@{
    name = "admissions-crm-production"
    version = $Version
    created_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    database_upgrade_from_revision = $DatabaseUpgradeFromRevision
    expected_database_revision = $ExpectedDatabaseRevision
    git_commit = $gitCommit
    git_branch = $gitBranch
    source_worktree_dirty = $runtimeStatus.Count -gt 0
    source_runtime_changes = $runtimeStatus
    runtime_file_count = $entries.Count
    runtime_bytes = $runtimeBytes
    checksums_sha256 = $aggregateHash
    requirements_sha256 = ($entries | Where-Object { $_.path -eq "requirements.txt" }).sha256
    schema_guard_files = $schemaGuardFiles
    files = $entries
    excluded = @("crm.db", ".env", ".secret_key", "backups", "logs", "tests", "docs", "screenshots")
}
$manifestPath = Join-Path $ReleaseDir "release-manifest.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

$packageChecksums = @(
    [ordered]@{
        path = "SHA256SUMS"
        sha256 = (Get-FileHash -LiteralPath $checksumPath -Algorithm SHA256).Hash.ToLowerInvariant()
    },
    [ordered]@{
        path = "release-manifest.json"
        sha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
)
$packageChecksums | ForEach-Object { "$($_.sha256)  $($_.path)" } |
    Set-Content -LiteralPath (Join-Path $ReleaseDir "PACKAGE-SHA256SUMS") -Encoding ascii

$python = Get-ProjectPython
& $python (Join-Path $Root "scripts\verify_production_release.py") $ReleaseDir
if ($LASTEXITCODE -ne 0) {
    throw "Prepared production release verification failed with exit code $LASTEXITCODE"
}

Push-Location $ReleaseDir
$previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
try {
    $env:PYTHONDONTWRITEBYTECODE = "1"
    $headOutput = @(& $python -m alembic -c alembic.ini heads 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Candidate Alembic head check failed with exit code $LASTEXITCODE"
    }
} finally {
    if ($null -eq $previousDontWriteBytecode) {
        Remove-Item Env:PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
    } else {
        $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
    }
    Pop-Location
}
$headLine = @($headOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) | Select-Object -First 1
$candidateHead = ([string]$headLine -split '\s+')[0]
if ($candidateHead -ne $ExpectedDatabaseRevision) {
    throw "Candidate Alembic head mismatch: expected $ExpectedDatabaseRevision, got $candidateHead"
}

Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $ZipPath -Force
$zipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$zipHash  $([System.IO.Path]::GetFileName($ZipPath))" | Set-Content -LiteralPath $ZipHashPath -Encoding ascii

Write-Host "Prepared production release:" -ForegroundColor Green
Write-Host "  Directory: $ReleaseDir"
Write-Host "  Archive:   $ZipPath"
Write-Host "  SHA256:    $zipHash"
Write-Host "  Files:     $($entries.Count)"
Write-Host "  Bytes:     $($manifest.runtime_bytes)"
