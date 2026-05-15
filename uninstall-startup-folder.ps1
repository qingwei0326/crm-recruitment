$ErrorActionPreference = "Stop"

$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "AdmissionsCRM.lnk"

if (Test-Path $ShortcutPath) {
    Remove-Item -LiteralPath $ShortcutPath
    Write-Host "Startup shortcut removed: $ShortcutPath"
} else {
    Write-Host "Startup shortcut not found: $ShortcutPath"
}
