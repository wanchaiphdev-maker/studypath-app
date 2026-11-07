# set-ai-key.ps1
# ใส่ค่า Gemini API Key ลง backend/.env (ไม่ต้องพิมพ์คีย์ลงแชต)
# ใช้:  powershell -ExecutionPolicy Bypass -File .\tools\set-ai-key.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root "backend\.env"

if (-not (Test-Path $envPath)) { throw "ไม่พบไฟล์ .env" }

Write-Host ""
Write-Host "=== ตั้งค่า AI Provider (Gemini) ===" -ForegroundColor Cyan
Write-Host "1) เปิด https://aistudio.google.com/apikey" -ForegroundColor Yellow
Write-Host "2) กด Create API key (เลือกโปรเจกต์ที่ต้องการ)" -ForegroundColor Yellow
Write-Host "3) คัดลอกคีย์ที่ขึ้นมา (ขึ้นต้น AIza...)" -ForegroundColor Yellow
Write-Host ""

$key = (Read-Host "วาง Gemini API Key ที่นี่ (จะไม่แสดงผลบนหน้าจอ)").Trim()
if (-not $key) { throw "ยกเลิก: ไม่ได้ใส่คีย์" }
if (-not $key.StartsWith("AIza")) {
  Write-Host "คำเตือน: คีย์ควรขึ้นต้นด้วย AIza" -ForegroundColor Yellow
}

function Set-EnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  $lines = [System.IO.File]::ReadAllLines($Path)
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") { $lines[$i] = "$Key=""$Value""" ; $found = $true }
  }
  if (-not $found) { $lines += "$Key=""$Value""" }
  [System.IO.File]::WriteAllLines($Path, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $envPath "$envPath.bak-$stamp"

Set-EnvValue $envPath "AI_BASE_URL"   "https://generativelanguage.googleapis.com/v1beta/openai"
Set-EnvValue $envPath "AI_API_KEY"    $key
Set-EnvValue $envPath "AI_MODEL"      "gemini-3.8-flash"

Write-Host ""
Write-Output "บันทึกเรียบร้อย" -ForegroundColor Green
Write-Output "  AI_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai"
Write-Output "  AI_MODEL    = gemini-3.8-flash"
Write-Output "  AI_API_KEY  = $($key.Substring(0,8))… (ยาว $($key.Length))"
Write-Output "  ไฟล์สำรอง : .env.bak-$stamp"
Write-Host ""
Write-Output "ขั้นต่อไป: รีสตาร์ท Backend" -ForegroundColor Yellow