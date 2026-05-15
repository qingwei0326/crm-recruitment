$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $Root "startup-launch.cmd"
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "AdmissionsCRM.lnk"

if (-not (Test-Path $Launcher)) {
    throw "startup-launch.cmd not found: $Launcher"
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Launcher
$Shortcut.WorkingDirectory = $Root
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Start Admissions CRM via PM2"
$Shortcut.Save()

Write-Host "Startup shortcut installed: $ShortcutPath"
