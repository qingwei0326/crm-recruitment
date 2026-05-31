$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $PSScriptRoot
$docsDir = Join-Path $projectRoot "docs"
$mdPath = Join-Path $docsDir "huaqi_trial_recruitment_quick_start.md"
$htmlPath = Join-Path $docsDir "huaqi_trial_recruitment_quick_start.html"
$soffice = "C:\Program Files\LibreOffice\program\soffice.com"

if (-not (Test-Path -LiteralPath $mdPath)) {
    throw "Markdown source not found: $mdPath"
}

if (-not (Test-Path -LiteralPath $soffice)) {
    throw "LibreOffice not found: $soffice"
}

function Convert-InlineMarkdown {
    param([string]$Text)

    $encoded = [System.Net.WebUtility]::HtmlEncode($Text)
    return [regex]::Replace($encoded, '`([^`]+)`', '<code>$1</code>')
}

$lines = Get-Content -Encoding UTF8 -LiteralPath $mdPath
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('<!doctype html>')
[void]$sb.AppendLine('<html><head><meta charset="utf-8">')
[void]$sb.AppendLine('<style>')
[void]$sb.AppendLine('@page{size:A4;margin:22mm 18mm;}')
[void]$sb.AppendLine('body{font-family:"Microsoft YaHei","SimSun",Arial,sans-serif;color:#111;line-height:1.72;font-size:12pt;}')
[void]$sb.AppendLine('h1{font-size:24pt;text-align:center;margin:0 0 18pt;color:#c00000;}')
[void]$sb.AppendLine('h2{font-size:16pt;margin:18pt 0 8pt;color:#c00000;border-bottom:1px solid #ddd;padding-bottom:4pt;}')
[void]$sb.AppendLine('h3{font-size:13.5pt;margin:12pt 0 6pt;color:#222;}')
[void]$sb.AppendLine('p{margin:4pt 0;}ul,ol{margin:4pt 0 8pt 20pt;padding:0;}li{margin:2pt 0;}')
[void]$sb.AppendLine('blockquote{border-left:4px solid #c00000;margin:8pt 0;padding:6pt 10pt;background:#fff5f5;}')
[void]$sb.AppendLine('code{font-family:Consolas,"Microsoft YaHei",monospace;background:#f3f4f6;padding:1pt 3pt;border-radius:3pt;}')
[void]$sb.AppendLine('.note{font-size:10pt;color:#555;text-align:center;margin-top:16pt;}')
[void]$sb.AppendLine('</style></head><body>')

$list = $null
foreach ($line in $lines) {
    $t = $line.TrimEnd()

    if ($t -eq "") {
        if ($list) {
            [void]$sb.AppendLine("</$list>")
            $list = $null
        }
        continue
    }

    if ($t.StartsWith("### ")) {
        if ($list) {
            [void]$sb.AppendLine("</$list>")
            $list = $null
        }
        [void]$sb.AppendLine("<h3>$(Convert-InlineMarkdown $t.Substring(4))</h3>")
        continue
    }

    if ($t.StartsWith("## ")) {
        if ($list) {
            [void]$sb.AppendLine("</$list>")
            $list = $null
        }
        [void]$sb.AppendLine("<h2>$(Convert-InlineMarkdown $t.Substring(3))</h2>")
        continue
    }

    if ($t.StartsWith("# ")) {
        if ($list) {
            [void]$sb.AppendLine("</$list>")
            $list = $null
        }
        [void]$sb.AppendLine("<h1>$(Convert-InlineMarkdown $t.Substring(2))</h1>")
        continue
    }

    if ($t.StartsWith("> ")) {
        if ($list) {
            [void]$sb.AppendLine("</$list>")
            $list = $null
        }
        [void]$sb.AppendLine("<blockquote>$(Convert-InlineMarkdown $t.Substring(2))</blockquote>")
        continue
    }

    if ($t.StartsWith("- ")) {
        if ($list -ne "ul") {
            if ($list) {
                [void]$sb.AppendLine("</$list>")
            }
            [void]$sb.AppendLine("<ul>")
            $list = "ul"
        }
        [void]$sb.AppendLine("<li>$(Convert-InlineMarkdown $t.Substring(2))</li>")
        continue
    }

    if ($t -match "^\d+\.\s+(.+)$") {
        if ($list -ne "ol") {
            if ($list) {
                [void]$sb.AppendLine("</$list>")
            }
            [void]$sb.AppendLine("<ol>")
            $list = "ol"
        }
        [void]$sb.AppendLine("<li>$(Convert-InlineMarkdown $Matches[1])</li>")
        continue
    }

    if ($list) {
        [void]$sb.AppendLine("</$list>")
        $list = $null
    }
    [void]$sb.AppendLine("<p>$(Convert-InlineMarkdown $t)</p>")
}

if ($list) {
    [void]$sb.AppendLine("</$list>")
}

[void]$sb.AppendLine('<p class="note">Generated from CRM docs.</p>')
[void]$sb.AppendLine('</body></html>')

[System.IO.File]::WriteAllText($htmlPath, $sb.ToString(), [System.Text.Encoding]::UTF8)

& $soffice --headless --convert-to docx --outdir $docsDir $htmlPath
& $soffice --headless --convert-to pdf --outdir $docsDir $htmlPath

Get-ChildItem -LiteralPath $docsDir -Filter "huaqi_trial_recruitment_quick_start.*" |
    Select-Object Name, Length, LastWriteTime
