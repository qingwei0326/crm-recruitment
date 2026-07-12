param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Resolve-WorkspacePath([string]$RelativePath) {
    $full = [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "path escapes workspace: $RelativePath"
    }
    return $full
}

$manifestFull = Resolve-WorkspacePath $ManifestPath
$manifest = Get-Content -LiteralPath $manifestFull -Raw | ConvertFrom-Json
$entries = @($manifest.entries)
if ($entries.Count -lt 1 -or $entries.Count -gt 8) {
    throw 'manifest entries must contain 1..8 files'
}

$outputFull = Resolve-WorkspacePath ([string]$manifest.output)
if ([IO.Path]::GetExtension($outputFull) -ne '.zip') { throw 'output must be a .zip file' }
if ((Test-Path -LiteralPath $outputFull) -and -not $Force) { throw "output already exists: $outputFull" }

$forbiddenNames = @('.env', '.env.linux', '.secret_key', 'package-lock.json', 'crm.db')
$forbiddenExtensions = @('.db', '.sqlite', '.sqlite3', '.pem', '.key', '.log', '.pid')
$seenNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$validated = foreach ($entry in $entries) {
    $source = Resolve-WorkspacePath ([string]$entry.source)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "source is missing: $source" }
    $name = [string]$entry.name
    if ([string]::IsNullOrWhiteSpace($name) -or $name -ne [IO.Path]::GetFileName($name)) {
        throw "entry name must be a flat filename: $name"
    }
    if (-not $seenNames.Add($name)) { throw "duplicate entry name: $name" }
    if ($forbiddenNames -contains [IO.Path]::GetFileName($source) -or
        $forbiddenExtensions -contains [IO.Path]::GetExtension($source).ToLowerInvariant() -or
        $source -match '[\\/]node_modules[\\/]') {
        throw "forbidden source: $source"
    }
    [pscustomobject]@{ Source = $source; Name = $name }
}

$outputDir = Split-Path -Parent $outputFull
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
if ($Force -and (Test-Path -LiteralPath $outputFull)) { Remove-Item -LiteralPath $outputFull -Force }
$staging = Join-Path $root ('.gemini-pack-stage-' + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    foreach ($entry in $validated) {
        Copy-Item -LiteralPath $entry.Source -Destination (Join-Path $staging $entry.Name)
    }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $outputFull -CompressionLevel Optimal
    $archive = [IO.Compression.ZipFile]::OpenRead($outputFull)
    try {
        if ($archive.Entries.Count -ne $validated.Count) { throw 'ZIP entry count mismatch' }
    } finally { $archive.Dispose() }
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}

[pscustomobject]@{
    output = $outputFull
    entries = $validated.Count
    size_kb = [math]::Round((Get-Item -LiteralPath $outputFull).Length / 1KB, 1)
} | ConvertTo-Json -Compress
