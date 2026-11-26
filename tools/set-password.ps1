# ตั้ง/รีเซ็ตรหัสผ่านให้บัญชี StudyPath
# ใช้เมื่อ: ลืมรหัสผ่าน หรือบัญชีที่เคยสมัครผ่าน Google (ซึ่งไม่มีรหัสผ่านจริง)
# รหัสผ่านถูกส่งเข้าโปรแกรมทาง stdin เท่านั้น ไม่ถูกบันทึกหรือแสดงบนหน้าจอ

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo "backend"

Write-Host "== StudyPath: ตั้งรหัสผ่านใหม่ ==" -ForegroundColor Cyan
$email = (Read-Host "อีเมลของบัญชี").Trim().ToLower()
if (-not $email) { Write-Host "ต้องกรอกอีเมล" -ForegroundColor Red; exit 1 }

$s1 = Read-Host "รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)" -AsSecureString
$s2 = Read-Host "ยืนยันรหัสผ่านใหม่" -AsSecureString

$b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1)
$b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2)
try {
  $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1)
  $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1) | Out-Null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2) | Out-Null
}

if ($p1 -ne $p2) { Write-Host "รหัสผ่านทั้งสองครั้งไม่ตรงกัน" -ForegroundColor Red; exit 1 }
if ($p1.Length -lt 8) { Write-Host "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" -ForegroundColor Red; exit 1 }

$json = @{ email = $email; password = $p1 } | ConvertTo-Json -Compress
$p1 = $null; $p2 = $null

Push-Location $backend
try {
  $json | & node "node_modules\ts-node\dist\bin.js" "scripts\set-password.ts"
  if ($LASTEXITCODE -ne 0) { Write-Host "ตั้งรหัสผ่านไม่สำเร็จ (ดูข้อความด้านบน)" -ForegroundColor Red; exit $LASTEXITCODE }
} finally {
  Pop-Location
}
Write-Host ""
Write-Host "เสร็จแล้ว — เปิดลิงก์แล้วเข้าสู่ระบบด้วยอีเมลนี้ + รหัสใหม่ได้เลย" -ForegroundColor Green
