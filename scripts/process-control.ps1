function Test-CrmManagedProcess {
    param(
        [Parameter(Mandatory = $true)] $ProcessInfo,
        [Parameter(Mandatory = $true)] [string] $Root
    )

    $CommandLine = [string]$ProcessInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }

    $ForwardScript = [System.IO.Path]::GetFullPath((Join-Path $Root "forward.js")).Replace("/", "\")
    $NormalizedCommandLine = $CommandLine.Replace("/", "\")

    $IsBackend =
        $CommandLine -like "*uvicorn*" -and
        $CommandLine -like "*app.main:app*" -and
        $CommandLine -like "*--port*" -and
        $CommandLine -like "*8000*"
    $IsForward = $NormalizedCommandLine.IndexOf($ForwardScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0

    return $IsBackend -or $IsForward
}

function Stop-CrmProcessId {
    param(
        [Parameter(Mandatory = $true)] [int] $ProcessId,
        [Parameter(Mandatory = $true)] [string] $Root
    )

    if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
        return $false
    }

    $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $ProcessInfo) {
        return $false
    }
    if (-not (Test-CrmManagedProcess -ProcessInfo $ProcessInfo -Root $Root)) {
        return $false
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    return $true
}

function Stop-CrmProcesses {
    param(
        [Parameter(Mandatory = $true)] [string] $Root,
        [string[]] $PidFiles = @()
    )

    foreach ($PidFile in $PidFiles) {
        if (-not (Test-Path $PidFile)) {
            continue
        }
        $PidValue = (Get-Content -Raw $PidFile).Trim()
        if ($PidValue -match '^\d+$') {
            Stop-CrmProcessId -ProcessId ([int]$PidValue) -Root $Root | Out-Null
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    $ManagedProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and (Test-CrmManagedProcess -ProcessInfo $_ -Root $Root) } |
        Sort-Object ProcessId -Unique
    foreach ($ProcessInfo in $ManagedProcesses) {
        Stop-Process -Id $ProcessInfo.ProcessId -Force -ErrorAction SilentlyContinue
    }

    $PortOwners = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($OwnerPid in $PortOwners) {
        Stop-CrmProcessId -ProcessId ([int]$OwnerPid) -Root $Root | Out-Null
    }

    $Deadline = (Get-Date).AddSeconds(8)
    do {
        $Remaining = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessId -ne $PID -and (Test-CrmManagedProcess -ProcessInfo $_ -Root $Root) })
        if ($Remaining.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $Deadline)
}

function Assert-CrmPortAvailable {
    param(
        [Parameter(Mandatory = $true)] [string] $Root
    )

    $Listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
    if ($Listeners.Count -eq 0) {
        return
    }

    $Details = foreach ($Listener in $Listeners) {
        $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($Listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($ProcessInfo) {
            "$($Listener.LocalAddress):$($Listener.LocalPort) pid=$($Listener.OwningProcess) $($ProcessInfo.Name) $($ProcessInfo.CommandLine)"
        } else {
            "$($Listener.LocalAddress):$($Listener.LocalPort) pid=$($Listener.OwningProcess)"
        }
    }
    throw "Port 8000 is still in use after stopping CRM processes: $($Details -join '; ')"
}
