# set-google-oauth.ps1
# ใส่ค่า OAuth ของ Google ใหม่ให้ StudyPath (ไม่ต้องพิมพ์ Client Secret ลงแชตหรือไฟล์ text)
# ใช้:  powershell -ExecutionPolicy Bypass -File .\tools\set-google-oauth.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backendEnv = Join-Path $root "backend\.env"
$mobileEnv  = Join-Path $root "mobile\.env"

foreach ($f in @($backendEnv, $mobileEnv)) {
    if (-not (Test-Path $f)) { throw "ไม่พบไฟล์: $f" }
}

# --- รับค่าจากผู้ใช้ (Secret ถูกอ่านแบบซ่อน ไม่แสดงบนหน้าจอ) ---
$clientId = (Read-Host "GOOGLE_CLIENT_ID").Trim()
if (-not $clientId) { throw "ยกเลิก: ไม่ได้ใส่ Client ID" }

$secure = Read-Host "GOOGLE_CLIENT_SECRET (พิมพ์แล้วจะไม่แสดง)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $clientSecret) { throw "ยกเลิก: ไม่ได้ใส่ Client Secret" }

# --- แก้ค่าใน .env ---
function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = [System.IO.File]::ReadAllLines($Path)
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") {
            $lines[$i] = "$Key=""$Value"""
            $found = $true
        }
    }
    if (-not $found) { $lines += "$Key=""$Value""" }
    # เขียนแบบ UTF-8 ไม่มี BOM (กัน dotenv อ่านค่าตัวแรกเพี้ยน)
    [System.IO.File]::WriteAllLines($Path, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

# --- สำรองก่อนแก้ ---
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $backendEnv "$backendEnv.bak-$stamp"
Copy-Item $mobileEnv  "$mobileEnv.bak-$stamp"

Set-EnvValue -Path $backendEnv -Key "GOOGLE_CLIENT_ID"     -Value $clientId
Set-EnvValue -Path $backendEnv -Key "GOOGLE_CLIENT_SECRET" -Value $clientSecret
Set-EnvValue -Path $mobileEnv  -Key "EXPO_PUBLIC_GOOGLE_CLIENT_ID" -Value $clientId

# --- สรุปผล (ไม่แสดง Secret) ---
function Read-EnvValue {
    param([string]$Path, [string]$Key)
    $l = [System.IO.File]::ReadAllLines($Path) | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } | Select-Object -First 1
    if ($l) { return (($l -split '=', 2)[1]).Trim().Trim('"') }
    return $null
}

$mask = if ($clientSecret.Length -gt 6) { $clientSecret.Substring(0,6) + "…(" + $clientSecret.Length + " ตัวอักษร)" } else { "<สั้นเกินกว่าจะแสดง>" }
Write-Host ""
Write-Host "บันทึกเรียบร้อย" -ForegroundColor Green
Write-Host "  backend\.env  GOOGLE_CLIENT_ID      = $clientId"
Write-Host "  backend\.env  GOOGLE_CLIENT_SECRET  = $mask"
Write-Host "  mobile\.env   EXPO_PUBLIC_GOOGLE_CLIENT_ID = $clientId"
Write-Host "  ไฟล์สำรอง : *.bak-$stamp"
Write-Host ""
Write-Host "ขั้นต่อไป: รีสตาร์ท Backend และ Expo ใหม่" -ForegroundColor Yellow