$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exporter = Join-Path $PSScriptRoot 'export_gemini_code_bundle.ps1'
$sandbox = Join-Path $root ('.gemini-bundle-test-' + [guid]::NewGuid().ToString('N'))
$output = Join-Path $sandbox 'bundle.txt'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

try {
    New-Item -ItemType Directory -Path $sandbox | Out-Null
    $sourceDir = Join-Path $sandbox 'source'
    New-Item -ItemType Directory -Path $sourceDir | Out-Null
    'const answer = 42;' | Set-Content -LiteralPath (Join-Path $sourceDir 'sample.js') -Encoding utf8

    $result = & $exporter -InputPath ([IO.Path]::GetRelativePath($root, $sourceDir)) -OutputPath ([IO.Path]::GetRelativePath($root, $output)) -Task 'test task' | ConvertFrom-Json
    Assert-True ($result.files -eq 1) 'expected one file in bundle'
    $bundle = Get-Content -LiteralPath $output -Raw
    Assert-True ($bundle -match 'TASK: test task') 'task header missing'
    Assert-True ($bundle -match 'BEGIN FILE: .*sample.js') 'begin marker missing'
    Assert-True ($bundle -match 'const answer = 42;') 'source content missing'
    Assert-True ($bundle -match 'END FILE: .*sample.js') 'end marker missing'

    $secret = Join-Path $sourceDir '.env'
    'DO_NOT_EXPORT=true' | Set-Content -LiteralPath $secret -Encoding utf8
    $rejected = $false
    try {
        & $exporter -InputPath ([IO.Path]::GetRelativePath($root, $secret)) -OutputPath ([IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'secret.txt'))) | Out-Null
    } catch {
        $rejected = $_.Exception.Message -match 'refusing|sensitive'
    }
    Assert-True $rejected 'sensitive file was not rejected'

    $runtimeConfig = Join-Path $sourceDir 'frpc.ini'
    'server = internal.example' | Set-Content -LiteralPath $runtimeConfig -Encoding utf8
    $runtimeRejected = $false
    try {
        & $exporter -InputPath ([IO.Path]::GetRelativePath($root, $runtimeConfig)) -OutputPath ([IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'runtime.txt'))) | Out-Null
    } catch {
        $runtimeRejected = $_.Exception.Message -match 'refusing|sensitive'
    }
    Assert-True $runtimeRejected 'runtime configuration was not rejected'

    'PASS: Gemini code bundle export checks'
} finally {
    if (Test-Path -LiteralPath $sandbox) { Remove-Item -LiteralPath $sandbox -Recurse -Force }
}
