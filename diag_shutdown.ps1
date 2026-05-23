# J1900 关机原因诊断脚本
# 用法：右键 → 用 PowerShell 运行（管理员）。会自检管理员权限，没权限时会自动重启提权。
# 输出会同时显示在屏幕上，并写到当前目录 shutdown_report_<时间>.txt，把这个文件发回来即可。

# 自动提权
$IsAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Write-Host "需要管理员权限，正在自动提权重启..." -ForegroundColor Yellow
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$OutFile = Join-Path $PSScriptRoot ("shutdown_report_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".txt")

function Write-Both {
    param([string]$Text = "", [ConsoleColor]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
    Add-Content -Path $OutFile -Value $Text -Encoding UTF8
}

function Write-Section {
    param([string]$Title)
    Write-Both ""
    Write-Both ("=" * 70) Cyan
    Write-Both $Title Cyan
    Write-Both ("=" * 70) Cyan
}

Set-Content -Path $OutFile -Value "J1900 关机诊断报告  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding UTF8
Write-Host "报告输出文件：$OutFile" -ForegroundColor Green

# ── 1. 系统基本信息 ─────────────────────────────────────────────
Write-Section "1. 系统基本信息"
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
Write-Both ("计算机名:     " + $cs.Name)
Write-Both ("型号:         " + $cs.Manufacturer + " " + $cs.Model)
Write-Both ("OS:           " + $os.Caption + " (" + $os.Version + ")")
Write-Both ("BIOS:         " + $bios.Manufacturer + " " + $bios.SMBIOSBIOSVersion + "  (" + $bios.ReleaseDate.ToString('yyyy-MM-dd') + ")")
Write-Both ("内存:         " + [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) + " GB")
Write-Both ("上次启动:     " + $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss'))
Write-Both ("当前运行时长: " + [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) + " 小时")

# ── 2. 开关机事件时间线 ─────────────────────────────────────────
Write-Section "2. 最近开关机事件（按时间倒序，最近的在最上）"

$events = Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    Id      = 41, 42, 107, 109, 1074, 1076, 6005, 6006, 6008
} -MaxEvents 40 -ErrorAction SilentlyContinue

if (-not $events) {
    Write-Both "没找到任何开关机事件（可能日志被清过或权限不足）" Yellow
} else {
    $rows = foreach ($e in $events | Sort-Object TimeCreated -Descending) {
        $tag = switch ($e.Id) {
            41   { '[!!] 意外重启（断电/死机/蓝屏）' }
            42   { '[..] 进入睡眠' }
            107  { '[..] 从睡眠唤醒' }
            109  { '[..] 按电源键关机' }
            1074 { '[??] 进程发起关机/重启' }
            1076 { '[..] 关机原因记录' }
            6005 { '[OK] 系统启动' }
            6006 { '[OK] 正常关机' }
            6008 { '[!!] 上次未正常关闭' }
        }
        # 把 Message 压成一行
        $msg = ($e.Message -replace '\s+', ' ').Trim()
        if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) + "..." }
        [PSCustomObject]@{
            Time = $e.TimeCreated.ToString('MM-dd HH:mm:ss')
            Id   = $e.Id
            Tag  = $tag
            Msg  = $msg
        }
    }
    $tableText = ($rows | Format-Table -AutoSize -Wrap | Out-String).TrimEnd()
    Write-Both $tableText
}

# ── 3. 蓝屏崩溃记录 ─────────────────────────────────────────────
Write-Section "3. 蓝屏 (BugCheck) 崩溃记录"
$bugchecks = Get-WinEvent -FilterHashtable @{
    LogName      = 'System'
    ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting', 'Microsoft-Windows-Kernel-Power'
    Id           = 1001, 1018
} -MaxEvents 5 -ErrorAction SilentlyContinue
$bc2 = Get-WinEvent -ProviderName 'BugCheck' -MaxEvents 5 -ErrorAction SilentlyContinue
$all = @($bugchecks) + @($bc2) | Where-Object { $_ } | Sort-Object TimeCreated -Descending | Select-Object -First 5
if (-not $all) {
    Write-Both "近期没有蓝屏/BugCheck 记录" Green
} else {
    foreach ($e in $all) {
        Write-Both ("[" + $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') + "] ID=" + $e.Id + " Provider=" + $e.ProviderName)
        Write-Both ("  " + ($e.Message -replace '\s+', ' ').Trim())
    }
}

# ── 4. 关机原因码（1074 详细解析）────────────────────────────────
Write-Section "4. 进程发起的关机/重启（1074 详情：谁触发的，为什么）"
$shutdownEvents = Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    Id      = 1074
} -MaxEvents 10 -ErrorAction SilentlyContinue
if (-not $shutdownEvents) {
    Write-Both "没有进程发起的关机事件（说明都不是程序触发的）" Green
} else {
    foreach ($e in $shutdownEvents) {
        Write-Both ("[" + $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') + "]")
        Write-Both ("  " + ($e.Message -replace '\s+', ' ').Trim())
    }
}

# ── 5. 电源/磁盘/温度相关错误警告 ──────────────────────────────
Write-Section "5. 电源/磁盘/温度相关 Error/Warning（最近 500 条系统日志中筛）"
$power = Get-WinEvent -LogName System -MaxEvents 500 -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.ProviderName -match 'Power|Disk|Thermal|Storage|Ntfs|volmgr') -and
        ($_.LevelDisplayName -in 'Error', 'Critical', 'Warning')
    } | Select-Object -First 15
if (-not $power) {
    Write-Both "没有相关警告/错误" Green
} else {
    $tbl = $power | ForEach-Object {
        [PSCustomObject]@{
            Time     = $_.TimeCreated.ToString('MM-dd HH:mm')
            Level    = $_.LevelDisplayName
            Provider = $_.ProviderName -replace 'Microsoft-Windows-', ''
            Id       = $_.Id
            Msg      = ($_.Message -replace '\s+', ' ').Trim().Substring(0, [Math]::Min(140, ($_.Message -replace '\s+', ' ').Length))
        }
    }
    Write-Both (($tbl | Format-Table -AutoSize -Wrap | Out-String).TrimEnd())
}

# ── 6. 应用程序关键错误 ─────────────────────────────────────────
Write-Section "6. 关机时间点前后的应用错误（关注 .NET/Python/uvicorn 等）"
# 取最近一次 6008 或 41 的时间作为关机时刻
$crashTime = ($events | Where-Object { $_.Id -in 41, 6008 } | Sort-Object TimeCreated -Descending | Select-Object -First 1).TimeCreated
if ($crashTime) {
    Write-Both ("用最近一次意外关机时间作为参考点: " + $crashTime.ToString('yyyy-MM-dd HH:mm:ss'))
    $appWindow = Get-WinEvent -FilterHashtable @{
        LogName   = 'Application'
        Level     = 1, 2, 3
        StartTime = $crashTime.AddMinutes(-10)
        EndTime   = $crashTime.AddMinutes(2)
    } -ErrorAction SilentlyContinue | Select-Object -First 20
    if (-not $appWindow) {
        Write-Both "关机前 10 分钟内没有应用错误" Green
    } else {
        $tbl = $appWindow | ForEach-Object {
            [PSCustomObject]@{
                Time     = $_.TimeCreated.ToString('HH:mm:ss')
                Level    = $_.LevelDisplayName
                Provider = $_.ProviderName
                Id       = $_.Id
                Msg      = ($_.Message -replace '\s+', ' ').Trim().Substring(0, [Math]::Min(140, ($_.Message -replace '\s+', ' ').Length))
            }
        }
        Write-Both (($tbl | Format-Table -AutoSize -Wrap | Out-String).TrimEnd())
    }
} else {
    Write-Both "近期没有意外关机事件，跳过" Green
}

# ── 7. 是否有 Memory.dmp / Minidump ────────────────────────────
Write-Section "7. 内存崩溃转储文件"
$dumpPaths = @("$env:SystemRoot\MEMORY.DMP", "$env:SystemRoot\Minidump")
foreach ($p in $dumpPaths) {
    if (Test-Path $p) {
        if ((Get-Item $p).PSIsContainer) {
            $dmps = Get-ChildItem $p -Filter "*.dmp" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
            if ($dmps) {
                Write-Both "Minidump 目录有崩溃文件：" Yellow
                foreach ($d in $dmps) {
                    Write-Both ("  " + $d.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  " + $d.Name + "  (" + [math]::Round($d.Length / 1KB) + " KB)")
                }
            } else {
                Write-Both ($p + ": 目录在但没有 .dmp 文件")
            }
        } else {
            $f = Get-Item $p
            Write-Both ("MEMORY.DMP 存在: " + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  (" + [math]::Round($f.Length / 1MB) + " MB)") Yellow
        }
    } else {
        Write-Both ($p + " 不存在")
    }
}

# ── 8. 后端服务状态（招生系统）─────────────────────────────────
Write-Section "8. 招生系统后端服务状态（如果在 D:\CRM）"
$crmRoot = "D:\CRM"
if (Test-Path $crmRoot) {
    $pidFile = Join-Path $crmRoot "backend.pid"
    if (Test-Path $pidFile) {
        $bpid = (Get-Content $pidFile -Raw).Trim()
        $proc = Get-Process -Id $bpid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Both ("后端进程 PID=" + $bpid + " 在跑，启动于 " + $proc.StartTime.ToString('yyyy-MM-dd HH:mm:ss')) Green
        } else {
            Write-Both ("backend.pid=" + $bpid + " 但进程不存在，后端没起来") Yellow
        }
    } else {
        Write-Both "没有 backend.pid 文件，后端可能没启动" Yellow
    }
    $port = Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($port) {
        Write-Both "127.0.0.1:8000 端口可连" Green
    } else {
        Write-Both "127.0.0.1:8000 端口连不上" Yellow
    }
} else {
    Write-Both ($crmRoot + " 不存在，跳过") Gray
}

# ── 结尾 ────────────────────────────────────────────────────────
Write-Section "完成"
Write-Both ("报告文件：" + $OutFile) Green
Write-Both ""
Write-Both "把这个 txt 发回来即可。Read me 关键指标：" Cyan
Write-Both "  - 看第 2 节最近一次关机是什么 Tag（[OK]/[!!]/[??]）"
Write-Both "  - 如果有 Event 41 配 6008 → 没收到关机指令的硬关机，多半是断电/硬件"
Write-Both "  - 如果有 1074 → 看 Message 里的进程名和 Reason"
Write-Both "  - 如果第 3 节有 BugCheck → 蓝屏，Message 里的代码能定位故障类型"
Write-Both "  - 如果第 7 节有 .dmp 文件 → 一定是蓝屏"

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
