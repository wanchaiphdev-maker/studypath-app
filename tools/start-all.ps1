# StudyPath — เปิดทุกอย่างในคำสั่งเดียว (หลังรีสตาร์ทเครื่อง / ไฟดับ)
#
#   powershell -ExecutionPolicy Bypass -File tools\start-all.ps1
#
# สิ่งที่สคริปต์ทำให้:
#   1) backend API  (พอร์ต 3000)
#   2) share server (พอร์ต 8090) — เสิร์ฟเว็บ + proxy API ให้อยู่โดเมนเดียวกัน
#   3) cloudflared tunnel — เปิดลิงก์สาธารณะให้เพื่อนเข้า (พิมพ์ลิงก์ให้ท้ายสคริปต์)
#   4) watchdog — คอยรีสตาร์ท backend/share server ถ้าตายระหว่างวัน
#
# หมายเหตุ: ลิงก์ trycloudflare จะเปลี่ยนทุกครั้งที่เริ่ม tunnel ใหม่
#           ตัวเว็บอ่านโดเมนจากเบราว์เซอร์เอง จึงไม่ต้อง build แอปใหม่เมื่อลิงก์เปลี่ยน
param(
  [int]$ApiPort = 3000,
  [int]$SharePort = 8090
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo "backend"
$temp = Join-Path $env:TEMP "opencode"
New-Item -ItemType Directory -Force $temp | Out-Null
$tunnelLog = Join-Path $temp "tunnel.log"
$linkFile = Join-Path $repo "LINK.txt"

function Test-Health($url) {
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 6
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-PortPid($port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

# ---------- 1) backend ----------
if (Test-Health "http://127.0.0.1:$ApiPort/health") {
  Write-Host "[1/4] backend ทำงานอยู่แล้ว"
} else {
  $old = Get-PortPid $ApiPort
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
  Write-Host "[1/4] เริ่ม backend ..."
  Start-Process node `
    -ArgumentList "node_modules\ts-node\dist\bin.js", "src/index.ts" `
    -WorkingDirectory $backend `
    -RedirectStandardOutput (Join-Path $repo "dev.log") `
    -RedirectStandardError (Join-Path $repo "err.log") `
    -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Health "http://127.0.0.1:$ApiPort/health") { break }
  }
  if (Test-Health "http://127.0.0.1:$ApiPort/health") { Write-Host "      backend พร้อมใช้งาน" }
  else { Write-Host "      backend ยังไม่ตอบ — ดู error ที่ err.log" }
}

# ---------- 2) share server ----------
if (Test-Health "http://127.0.0.1:$SharePort/login") {
  Write-Host "[2/4] share server ทำงานอยู่แล้ว"
} else {
  $old = Get-PortPid $SharePort
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
  Write-Host "[2/4] เริ่ม share server ..."
  Start-Process node `
    -ArgumentList (Join-Path $repo "tools\share-server.js") `
    -WorkingDirectory $repo `
    -RedirectStandardOutput (Join-Path $temp "share.log") `
    -RedirectStandardError (Join-Path $temp "share.err.log") `
    -WindowStyle Hidden
  Start-Sleep -Seconds 4
}

# ---------- 3) tunnel ----------
$cfExe = Join-Path $repo "tools\bin\cloudflared.exe"
if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
  if (Test-Path $cfExe) {
    Write-Host "[3/4] เปิด tunnel ..."
    Remove-Item $tunnelLog -Force -ErrorAction SilentlyContinue
    Start-Process $cfExe `
      -ArgumentList "tunnel", "--url", "http://127.0.0.1:$SharePort", "--no-autoupdate" `
      -RedirectStandardError $tunnelLog `
      -RedirectStandardOutput (Join-Path $temp "tunnel.out.log") `
      -WindowStyle Hidden
  } else {
    Write-Host "[3/4] ไม่พบ tools\bin\cloudflared.exe — ข้ามการเปิดลิงก์สาธารณะ"
  }
} else {
  Write-Host "[3/4] tunnel ทำงานอยู่แล้ว"
}

$publicUrl = $null
for ($i = 0; $i -lt 30 -and -not $publicUrl; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $tunnelLog) {
    $m = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | Select-Object -First 1
    if ($m) {
      $candidate = $m.Matches | Where-Object { $_.Value -ne "https://api.trycloudflare.com" } | Select-Object -First 1
      if ($candidate) { $publicUrl = $candidate.Value }
    }
  }
}

# ---------- 4) watchdog ----------
$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match "watchdog\.ps1" }
if ($running) {
  Write-Host "[4/4] watchdog ทำงานอยู่แล้ว"
} else {
  Write-Host "[4/4] เริ่ม watchdog ..."
  Start-Process powershell `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $repo "tools\watchdog.ps1") `
    -RedirectStandardOutput (Join-Path $temp "wd.out.log") `
    -RedirectStandardError (Join-Path $temp "wd.err.log") `
    -WindowStyle Hidden
}

if ($publicUrl) {
  Set-Content -Path $linkFile -Value $publicUrl -Encoding ascii
  Write-Host ""
  Write-Host "ลิงก์สำหรับแชร์ให้เพื่อน:"
  Write-Host "  $publicUrl"
  Write-Host "(บันทึกไว้ที่ LINK.txt ด้วย)"
} else {
  # อย่าทิ้ง URL ของ Cloudflare API ไว้ให้ผู้ใช้เข้าใจผิดว่าเป็นเว็บแอป
  if ((Get-Content -Path $linkFile -Raw -ErrorAction SilentlyContinue).Trim() -eq "https://api.trycloudflare.com") {
    Set-Content -Path $linkFile -Value "ยังไม่มีลิงก์สาธารณะที่ใช้งานได้ — เปิดระบบจากเครื่องหลักแล้วรอให้ tunnel สร้างลิงก์ก่อน" -Encoding utf8
  }
  Write-Host ""
  Write-Host "ยังไม่ได้ลิงก์ public — ตรวจสอบ tunnel ที่ $tunnelLog"
}
