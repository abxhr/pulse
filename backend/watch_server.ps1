$ErrorActionPreference = "SilentlyContinue"

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
$logDir = Join-Path $backendDir "data\logs"
$stdoutLog = Join-Path $logDir "server.log"
$stderrLog = Join-Path $logDir "server-error.log"
$healthUrl = "http://127.0.0.1:8080/api/health"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Prevent the Startup shortcut and a manual launch from creating two watchdogs.
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\PulseServerWatchdog", [ref]$createdNew)
if (-not $createdNew) { exit 0 }

function Write-WatchLog([string]$message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath (Join-Path $logDir "watchdog.log") -Value "[$stamp] $message"
}

function Test-PulseHealth {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri $healthUrl
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-PulsePid {
    return Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
}

function Start-Pulse {
    if (-not (Test-Path -LiteralPath $pythonExe)) {
        Write-WatchLog "Cannot start: virtual-environment Python not found at $pythonExe"
        return
    }
    Write-WatchLog "Starting Pulse"
    Start-Process -FilePath $pythonExe -ArgumentList "-m", "app.main" `
        -WorkingDirectory $backendDir -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
}

Write-WatchLog "Watchdog started"

try {
    $failures = 0
    while ($true) {
        if (Test-PulseHealth) {
            $failures = 0
        } else {
            $failures++
            Write-WatchLog "Health check failed ($failures/3)"
        }

        if ($failures -ge 3) {
            $pulsePid = Get-PulsePid
            if ($pulsePid) {
                Write-WatchLog "Stopping unresponsive Pulse process $pulsePid"
                Stop-Process -Id $pulsePid -Force
                Start-Sleep -Seconds 3
            }
            Start-Pulse
            Start-Sleep -Seconds 15
            $failures = 0
        } elseif (-not (Get-PulsePid)) {
            Start-Pulse
            Start-Sleep -Seconds 15
        }

        Start-Sleep -Seconds 30
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
