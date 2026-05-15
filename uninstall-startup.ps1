$ErrorActionPreference = "Stop"

$TaskName = "AdmissionsCRM"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Startup task removed: $TaskName"
} else {
    Write-Host "Startup task not found: $TaskName"
}
