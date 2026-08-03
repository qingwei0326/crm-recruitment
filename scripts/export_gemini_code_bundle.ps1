<#
.SYNOPSIS
    Export selected project source files into one text bundle for Gemini.

.DESCRIPTION
    Each file is wrapped in explicit BEGIN FILE / END FILE markers. The bundle
    intentionally excludes credentials, databases, runtime data, dependencies,
    logs, releases, and build output.

    Examples:
      powershell -File .\scripts\export_gemini_code_bundle.ps1 -AllCode
      powershell -File .\scripts\export_gemini_code_bundle.ps1 -InputPath frontend\src
      powershell -File .\scripts\export_gemini_code_bundle.ps1 `
        -InputPath frontend\src\pages\admin\AdminDash.jsx,frontend\src\index.css
#>

[CmdletBinding()]
param(
    [string[]]$InputPath,
    [switch]$AllCode,
    [string]$OutputPath = 'outputs\gemini-code-bundle.txt',
    [string]$Task = '请在保持现有功能和接口兼容的前提下，完成我描述的修改。'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

$allowedExtensions = @(
    '.py', '.pyi', '.ps1', '.psm1', '.sh', '.bash', '.js', '.jsx', '.ts', '.tsx',
    '.css', '.scss', '.html', '.htm', '.json', '.yaml', '.yml', '.toml', '.ini',
    '.sql', '.md'
)
$forbiddenNames = @(
    '.env', '.env.linux', '.secret_key', 'crm.db', 'crm.db-shm', 'crm.db-wal',
    '服务器访问说明.txt', '.mcp.json', 'frpc.ini', 'cloudflared-config.yml',
    'forward.js', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
)
$excludedDirectoryNames = @(
    '.git', '.venv-win', '.venv-linux', '.pytest_cache', '.ruff_cache', '__pycache__',
    'node_modules', 'dist', 'test-results', 'playwright-report', 'screenshots',
    'backups', 'data', 'releases', 'artifacts', 'outputs'
)
$forbiddenExtensions = @('.db', '.sqlite', '.sqlite3', '.pem', '.key', '.log', '.pid', '.zip')

function Resolve-WorkspacePath([string]$RelativePath) {
    $candidate = if ([IO.Path]::IsPathRooted($RelativePath)) {
        [IO.Path]::GetFullPath($RelativePath)
    } else {
        [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    }
    if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and
        $candidate -ne $root) {
        throw "path escapes workspace: $RelativePath"
    }
    return $candidate
}

function Get-RelativeWorkspacePath([string]$FullPath) {
    return ([IO.Path]::GetRelativePath($root, $FullPath)).Replace('\', '/')
}

function Test-ExcludedFile([IO.FileInfo]$File) {
    $relative = Get-RelativeWorkspacePath $File.FullName
    $parts = $relative -split '/'
    foreach ($part in $parts) {
        if ($excludedDirectoryNames -contains $part) { return $true }
    }

    $name = $File.Name
    $extension = $File.Extension.ToLowerInvariant()
    if ($forbiddenNames -contains $name) { return $true }
    if ($forbiddenExtensions -contains $extension) { return $true }
    if ($allowedExtensions -notcontains $extension) { return $true }
    return $false
}

$selected = [Collections.Generic.Dictionary[string, IO.FileInfo]]::new([StringComparer]::OrdinalIgnoreCase)

function Add-SourceFile([string]$FullPath) {
    $file = Get-Item -LiteralPath $FullPath -ErrorAction Stop
    if (-not ($file -is [IO.FileInfo])) { throw "source is not a file: $FullPath" }
    if (Test-ExcludedFile $file) {
        throw "refusing to include sensitive, generated, or unsupported file: $(Get-RelativeWorkspacePath $file.FullName)"
    }
    $relative = Get-RelativeWorkspacePath $file.FullName
    if (-not $selected.ContainsKey($relative)) { $selected.Add($relative, $file) }
}

function Add-SourcePath([string]$RequestedPath) {
    $full = Resolve-WorkspacePath $RequestedPath
    if (-not (Test-Path -LiteralPath $full)) { throw "source is missing: $RequestedPath" }
    $item = Get-Item -LiteralPath $full
    if ($item -is [IO.DirectoryInfo]) {
        $files = Get-ChildItem -LiteralPath $full -Recurse -File | Where-Object {
            -not (Test-ExcludedFile $_)
        }
        foreach ($file in $files) { Add-SourceFile $file.FullName }
    } else {
        Add-SourceFile $full
    }
}

if ($AllCode -and $InputPath) {
    throw 'use either -AllCode or -InputPath, not both'
}
if (-not $AllCode -and (-not $InputPath -or $InputPath.Count -eq 0)) {
    throw 'provide -AllCode or at least one -InputPath'
}

if ($AllCode) {
    Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
        -not (Test-ExcludedFile $_)
    } | ForEach-Object {
        Add-SourceFile $_.FullName
    }
} else {
    foreach ($requestedPath in $InputPath) { Add-SourcePath $requestedPath }
}

$files = @($selected.Values | Sort-Object { Get-RelativeWorkspacePath $_.FullName })
if ($files.Count -eq 0) { throw 'no source files selected' }

$outputFull = Resolve-WorkspacePath $OutputPath
$outputParent = Split-Path -Parent $outputFull
New-Item -ItemType Directory -Path $outputParent -Force | Out-Null

$builder = [Text.StringBuilder]::new()
[void]$builder.AppendLine('# GEMINI CODE BUNDLE v1')
[void]$builder.AppendLine('# This file is a source bundle. File boundaries are explicit and must be preserved.')
[void]$builder.AppendLine('# For an edit, return only changed files using the same BEGIN FILE / END FILE markers.')
[void]$builder.AppendLine('# Do not invent paths, expose secrets, or change unrelated files.')
[void]$builder.AppendLine("# TASK: $Task")
[void]$builder.AppendLine("# GENERATED_AT: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'))")
[void]$builder.AppendLine("# FILE_COUNT: $($files.Count)")
[void]$builder.AppendLine('# FILES:')

foreach ($file in $files) {
    $relative = Get-RelativeWorkspacePath $file.FullName
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$builder.AppendLine("#   $relative  sha256=$hash")
}
[void]$builder.AppendLine()

foreach ($file in $files) {
    $relative = Get-RelativeWorkspacePath $file.FullName
    $extension = $file.Extension.TrimStart('.').ToLowerInvariant()
    $content = [IO.File]::ReadAllText($file.FullName, [Text.UTF8Encoding]::new($false, $true))
    $content = $content.Replace("`r`n", "`n").Replace("`r", "`n")
    [void]$builder.AppendLine("===== BEGIN FILE: $relative | language=$extension =====")
    [void]$builder.AppendLine($content.TrimEnd("`n"))
    [void]$builder.AppendLine("===== END FILE: $relative =====")
    [void]$builder.AppendLine()
}

$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($outputFull, $builder.ToString(), $utf8NoBom)

$totalChars = $builder.Length
[pscustomobject]@{
    output = $outputFull
    files = $files.Count
    chars = $totalChars
    size_kb = [math]::Round((Get-Item -LiteralPath $outputFull).Length / 1KB, 1)
    warning = if ($totalChars -gt 1200000) { 'bundle is large; export a focused directory for Gemini if the model rejects it' } else { $null }
} | ConvertTo-Json -Compress
