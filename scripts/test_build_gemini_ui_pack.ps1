$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$builder = Join-Path $PSScriptRoot 'build_gemini_ui_pack.ps1'
$sandbox = Join-Path $root ('.gemini-pack-test-' + [guid]::NewGuid().ToString('N'))

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Write-Manifest([string]$Path, [string]$Output, [object[]]$Entries) {
    @{ name = 'test-pack'; output = $Output; entries = $Entries } |
        ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $Path -Encoding utf8
}

try {
    New-Item -ItemType Directory -Path $sandbox | Out-Null
    'alpha' | Set-Content -LiteralPath (Join-Path $sandbox 'alpha.md') -Encoding utf8
    'beta' | Set-Content -LiteralPath (Join-Path $sandbox 'beta.jsx') -Encoding utf8

    $safeManifest = Join-Path $sandbox 'safe.json'
    $safeOutput = '.gemini-pack-test-output-' + [guid]::NewGuid().ToString('N') + '.zip'
    Write-Manifest $safeManifest $safeOutput @(
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'alpha.md')); name = '00-alpha.md' },
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'beta.jsx')); name = '01-beta.jsx' }
    )
    & $builder -ManifestPath ([IO.Path]::GetRelativePath($root, $safeManifest)) | Out-Null
    $safeZip = Join-Path $root $safeOutput
    Assert-True (Test-Path -LiteralPath $safeZip) 'safe pack was not created'

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($safeZip)
    try { Assert-True ($archive.Entries.Count -eq 2) 'safe pack entry count mismatch' }
    finally { $archive.Dispose() }

    $tooManyManifest = Join-Path $sandbox 'too-many.json'
    $nine = 1..9 | ForEach-Object {
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'alpha.md')); name = ('item-{0}.md' -f $_) }
    }
    Write-Manifest $tooManyManifest 'too-many.zip' $nine
    $tooManyRejected = $false
    try { & $builder -ManifestPath ([IO.Path]::GetRelativePath($root, $tooManyManifest)) | Out-Null }
    catch { $tooManyRejected = $_.Exception.Message -match '1..8' }
    Assert-True $tooManyRejected 'nine-entry manifest was not rejected'

    'secret' | Set-Content -LiteralPath (Join-Path $sandbox '.env') -Encoding utf8
    $secretManifest = Join-Path $sandbox 'secret.json'
    Write-Manifest $secretManifest 'secret.zip' @(
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox '.env')); name = '.env' }
    )
    $secretRejected = $false
    try { & $builder -ManifestPath ([IO.Path]::GetRelativePath($root, $secretManifest)) | Out-Null }
    catch { $secretRejected = $_.Exception.Message -match 'forbidden' }
    Assert-True $secretRejected 'sensitive file was not rejected'

    'PASS: Gemini pack builder safety checks'
} finally {
    Get-ChildItem -LiteralPath $root -Filter '.gemini-pack-test-output-*.zip' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
    if (Test-Path -LiteralPath $sandbox) { Remove-Item -LiteralPath $sandbox -Recurse -Force }
}
