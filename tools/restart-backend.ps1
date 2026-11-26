# รีสตาร์ท backend (API :3000) หลังแก้โค้ดหรือ .env เช่น เปลี่ยน TTS_VOICE
# ใช้: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\restart-backend.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo "backend"

Write-Host "== StudyPath: รีสตาร์ท backend ==" -ForegroundColor Cyan

$conn = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
foreach ($procId in ($conn.OwningProcess | Select-Object -Unique)) {
  if ($procId) {
    Write-Host "หยุด process $procId"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2

Start-Process node `
  -ArgumentList "node_modules\ts-node\dist\bin.js", "src/index.ts" `
  -WorkingDirectory $backend `
  -RedirectStandardOutput (Join-Path $repo "dev.log") `
  -RedirectStandardError (Join-Path $repo "err.log") `
  -WindowStyle Hidden

Write-Host "กำลังบูต (~20-30 วินาที)..."
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:3000/health" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) {
      Write-Host "พร้อมใช้งานแล้ว: $($r.Content)" -ForegroundColor Green
      exit 0
    }
  } catch { }
}

Write-Host "ยังไม่ตอบสนอง — ดู log ที่ dev.log / err.log" -ForegroundColor Red
exit 1
