# StudyPath — คู่มือใช้งานและดูแล (เครื่องนี้)

## ลิงก์ที่ส่งให้เพื่อน

อ่านจากไฟล์ `LINK.txt` ที่ root ของโปรเจกต์ (อัปเดตอัตโนมัติเมื่อ tunnel เริ่มใหม่)

```
Get-Content .\LINK.txt
```

## เริ่มระบบทั้งหมด (ครั้งเดียว)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-all.ps1
```

คำสั่งนี้จะเปิด API (3000), share server (8090), tunnel และ watchdog แล้วพิมพ์ลิงก์ให้
ถ้ารันซ้ำจะไม่เปิดซ้ำ (idempotent)

## โครงสร้างการทำงาน

```
เพื่อน → https://<tunnel>.trycloudflare.com
          → cloudflared → tools/share-server.js (8090, เสิร์ฟเว็บ + proxy /auth /studypath /health)
          → backend (Express, 3000) → PostgreSQL (Prisma)
```

- เว็บใช้ API ผ่าน origin เดียวกับหน้าจอ (`mobile/lib/api.ts` → `resolveBase()`)
  จึงไม่ต้อง build ใหม่เมื่อลิงก์ tunnel เปลี่ยน
- `tools/watchdog.ps1` ตรวจทุก 30 วินาที: backend/share ตาย → รีสตาร์ท,
  cloudflared ตาย → เปิด tunnel ใหม่ + เขียน `LINK.txt` ใหม่
- ทางเลือก: `tools/start-all.ps1` ถูกผูกไว้ใน Startup ของ Windows แล้ว
  (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\StudyPath.lnk`)

## ตรวจสุขภาพเร็ว ๆ

```powershell
(Invoke-WebRequest http://127.0.0.1:3000/health -UseBasicParsing).StatusCode   # 200
(Invoke-WebRequest http://127.0.0.1:8090/health -UseBasicParsing).StatusCode   # 200
Get-Process cloudflared
Get-Content (Join-Path $env:TEMP "studypath-watchdog\watchdog.log") -Tail 10 -Encoding UTF8
```

## อัปเดตเว็บหลังแก้โค้ด

```powershell
cd mobile
npx tsc --noEmit
npx expo export --platform web --output-dir web-share
```

ไม่ต้องรีสตาร์ท share server — มันอ่านไฟล์จาก `mobile/web-share` ทุกครั้ง
(ไฟล์ HTML ตั้ง `no-cache` แล้ว)

## AI / การค้นเนื้อหา

- ตอบโดยยึดไฟล์ใน Knowledge Base และใส่อ้างอิง `[1] [2]` ตามไฟล์จริง
- ถ้าไม่พบหลักฐานที่ชัด จะตอบเป็น "ความรู้ทั่วไป (ไม่ได้อยู่ในไฟล์ที่ซิงก์)" และไม่ใส่แหล่งอ้างอิง
- การค้นใช้ 2 ทางรวมกัน: ความหมาย (embedding) + ตัวอักษร 3 ตัวแบบถ่วงน้ำหนัก IDF
  (ภาษาไทยไม่เว้นวรรค จึงใช้ trigram) และถ้าพบวลาหายากตรงเป๊ะ (เช่น `มคอ.3`) จะดัน chunk นั้นขึ้นก่อน
- embedding ของเนื้อหาเติมอัตโนมัติโดย worker ทุก 10 นาที (โควตาฟรีของ Gemini)
  ตรวจความคืบหน้า:

```powershell
cd backend
npx ts-node scripts/backfill-embeddings.ts
```

## Google Login (ยังต้องทำใน Google Cloud Console)

ตอนนี้ปุ่ม Google จะซ่อนอัตโนมัติถ้ายังตั้งค่าไม่ครบ (`GET /auth/google/ready` → `ready:false`)
เพื่อนยังสมัคร/เข้าสู่ระบบด้วยอีเมล+รหัสผ่านได้ตามปกติ

ถ้าจะเปิด Google login บนลิงก์ tunnel:

1. ไปที่ Google Cloud Console → APIs & Services → Credentials → OAuth client (Web)
2. เพิ่ม Authorized redirect URI: `https://<โดเมนปัจจุบัน>/auth/google/callback`
   (ลิงก์ trycloudflare เปลี่ยนทุกครั้งที่ tunnel เริ่มใหม่ → ต้องอัปเดต URI ทุกครั้ง
   ถ้าต้องการถาวรต้องใช้ named tunnel + โดเมนของตัวเอง)
3. OAuth consent screen → เปลี่ยนชื่อแอปจาก "Amway Team" เป็น **StudyPath**
   และเพิ่มอีเมลเพื่อนใน Test users
4. ตรวจว่า `GET /auth/google/ready` ตอบ `{"ready":true}` แล้วรีเฟรชหน้า login

## สิ่งที่แก้ในรอบ "พร้อมใช้งาน"

- สมัครสมาชิกบนเว็บได้แล้ว (เดิมเรียก SecureStore ตรง ๆ จึง error `getValueWithKeyAsync is not a function`)
- เพิ่มวิชาเองได้ในแอป (ปุ่ม + ที่หน้าวิชาของฉัน) — สร้างปีการศึกษา/ภาคเรียนให้อัตโนมัติ
  ไม่ต้องรอซิงก์ Google Classroom
- อัปโหลดไฟล์จากเว็บได้แล้ว (เดิม FormData ส่ง `[object Object]` เพราะใช้รูปแบบของ React Native)
- หน้า AI Tutor: ปรับข้อความ/ปุ่มเมื่อยังไม่มีวิชา หรือวิชายังไม่มีเนื้อหา (พาไปเพิ่มวิชา/อัปโหลดต่อ)
- watchdog: เปิด tunnel ใหม่และอัปเดต `LINK.txt` เองเมื่อ cloudflared ตาย

## ข้อจำกัดที่รู้

- ลิงก์ `*.trycloudflare.com` เปลี่ยนเมื่อ tunnel เริ่มใหม่ (ฟรี) — ต้องส่งลิงก์ใหม่ให้เพื่อน
- Gemini free tier: แชทมีโควตาต่อวัน, embedding ~1,000 ชิ้น/วัน
  (worker เติมให้เองเรื่อย ๆ จนครบ; ถ้าเปิด billing จะเร็วขึ้นมาก)
- console มี warning `React error #418` (hydration) เป็นเรื่อง cosmetic ของ static export
  หน้าเว็บยังทำงานปกติ
