# StudyPath watchdog — คอยตรวจว่า backend (3000) และ share server (8090) ยังทำงานอยู่
# ถ้าตายหรือค้าง จะรีสตาร์ทให้อัตโนมัติ (ไม่แตะ cloudflared เพราะลิงก์จะเปลี่ยน)
#
# วิธีรัน (จากราก repo):
#   powershell -ExecutionPolicy Bypass -File tools\watchdog.ps1
param([int]$IntervalSec = 30)

$repo = Split-Path -Parent $PSScriptRoot
$temp = Join-Path $env:TEMP "studypath-watchdog"
New-Item -ItemType Directory -Force $temp | Out-Null
$log = Join-Path $temp "watchdog.log"
$lock = Join-Path $temp "watchdog.pid"

# กันรันซ้อน: ถ้ามี watchdog ตัวเก่าอยู่แล้วให้จบ
if (Test-Path $lock) {
  $old = (Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
    Write-Host "watchdog already running (pid $old)"
    exit 0
  }
}
Set-Content -Path $lock -Value $PID

function Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File -Append -Encoding utf8 $log
}

function Get-PortPid($port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

function Test-Health($url) {
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# process อาจกำลังบูตอยู่ (ts-node ใช้เวลา ~20 วิ) — อย่าเพิ่งสปอว์นซ้ำ
function Test-NodeCommand($pattern) {
  $hits = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }
  return [bool]$hits
}

function Start-Backend {
  Log "backend: เริ่มใหม่"
  Start-Process node `
    -ArgumentList "node_modules\ts-node\dist\bin.js", "src/index.ts" `
    -WorkingDirectory (Join-Path $repo "backend") `
    -RedirectStandardOutput (Join-Path $repo "dev.log") `
    -RedirectStandardError (Join-Path $repo "err.log") `
    -WindowStyle Hidden
}

function Start-Share {
  Log "share server: เริ่มใหม่"
  Start-Process node `
    -ArgumentList (Join-Path $repo "tools\share-server.js") `
    -WorkingDirectory $repo `
    -RedirectStandardOutput (Join-Path $temp "share.log") `
    -RedirectStandardError (Join-Path $temp "share.err.log") `
    -WindowStyle Hidden
}

$apiFails = 0
$shareFails = 0
$cfWarned = $false
Log "watchdog เริ่มทำงาน (ตรวจทุก $IntervalSec วินาที)"

while ($true) {
  # ---------- backend :3000 ----------
  if (Test-Health "http://127.0.0.1:3000/health") {
    $apiFails = 0
  } else {
    $apiFails++
    $pid3000 = Get-PortPid 3000
    if (-not $pid3000) {
      if (Test-NodeCommand "src[\\/]index\.ts") {
        Log "backend กำลังบูต — รอรอบถัดไป"
      } else {
        Start-Backend
        $apiFails = 0
      }
    } elseif ($apiFails -ge 2) {
      Log "backend ไม่ตอบสนอง (pid $pid3000) → บังคับรีสตาร์ท"
      Stop-Process -Id $pid3000 -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Start-Backend
      $apiFails = 0
    }
  }

  # ---------- share server :8090 ----------
  if (Test-Health "http://127.0.0.1:8090/health") {
    $shareFails = 0
  } else {
    $shareFails++
    $pid8090 = Get-PortPid 8090
    if (-not $pid8090) {
      if (Test-NodeCommand "share-server\.js") {
        Log "share server กำลังบูต — รอรอบถัดไป"
      } else {
        Start-Share
        $shareFails = 0
      }
    } elseif ($shareFails -ge 2) {
      Log "share server ไม่ตอบสนอง (pid $pid8090) → บังคับรีสตาร์ท"
      Stop-Process -Id $pid8090 -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Start-Share
      $shareFails = 0
    }
  }

  # ---------- tunnel (แจ้งเตือนเท่านั้น) ----------
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    if (-not $cfWarned) { Log "cloudflared ไม่ทำงาน — ลิงก์สาธารณะจะใช้ไม่ได้ (ต้องเริ่ม tunnel ใหม่)"; $cfWarned = $true }
  } else {
    $cfWarned = $false
  }

  Start-Sleep -Seconds $IntervalSec
}
