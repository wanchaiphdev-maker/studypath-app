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

## เสียงอ่านออกเสียง (TTS)

- ใช้เสียงเดียวเสมอ ตั้งได้ที่ `TTS_VOICE` ใน `backend/.env` (ค่าเริ่มต้น `Kore`)
  เสียงที่เลือกได้: `Kore`, `Aoede`, `Puck`, `Charon`, `Fenrir`
- เปลี่ยนเสียงแล้วรอให้มีผล:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\restart-backend.ps1
```
- ห้ามใส่ fallback หลายเสียงในโค้ด เพราะจะทำให้เสียงเปลี่ยนไปเรื่อย ๆ
  (เดิมไล่ Kore → Aoede → Puck → … แล้วแคชเสียงที่ fallback ไว้)
- ถ้าโควตา TTS หมด (429) แอปจะใช้เสียงเครื่อง (Siri/เบราว์เซอร์) ที่ล็อกไว้ตัวเดียว
  จนกว่าจะรีเฟรชหน้า — ไม่สลับทีละข้อความ และบน iPhone ระบบปลดล็อก `<audio>`
  ตั้งแต่จังหวะกดปุ่ม จึงเล่นเสียง Gemini ได้สม่ำเสมอ (ไม่ตกไป Siri มั่ว)
- ไฟล์เสียงแคชอยู่ที่ `backend/storage/tts` — ลบได้ ไม่กระทบข้อมูลผู้ใช้
  (แคชผูกกับรุ่นเสียง `v2` แล้ว ไฟล์เก่าที่เสียงไม่ตรงจะไม่ถูกใช้)

## อัปโหลดไฟล์เสียง/วิดีโอ (ถอดเสียง)

- รองรับไฟล์เสียง/วิดีโอไม่เกิน **18MB** (ข้อจำกัด inline ของ Gemini) — ไฟล์ใหญ่ให้ตัดเป็นท่อน
- ใช้ **Gemini native** (`generateContent` + `inlineData`) ผ่าน `AI_API_KEY` เดิม
  (เดิมยิง `/audio/transcriptions` ของ OpenAI-compat ซึ่ง Gemini ไม่มี → 404)
- ถ้ามี OpenAI/Whisper ตั้งใน `backend/.env` ระบบจะเลือก Whisper ก่อน:
  `AI_TRANSCRIBE_BASE_URL=https://api.openai.com/v1`, `AI_TRANSCRIBE_API_KEY=...`, `AI_TRANSCRIBE_MODEL=whisper-1`
- เปลี่ยนโมเดลถอดเสียงฝั่ง Gemini ได้ที่ `GEMINI_TRANSCRIBE_MODEL` (ค่าเริ่มต้นใช้ `AI_MODEL`)
- ไฟล์ที่อัปโหลดจะถูกเก็บที่ `backend/storage/materials` (ลบไฟล์ที่อัปโหลดไม่สำเร็จได้)

## Google Login (ยังต้องทำใน Google Cloud Console)

ปุ่ม **"เข้าสู่ระบบด้วย Google" แสดงตลอด** (เดิมซ่อนเมื่อยังตั้งค่าไม่ครบ ทำให้ผู้ใช้คิดว่าปุ่มหาย)
ถ้ายังไม่ได้ลงทะเบียน redirect URI ของลิงก์นี้ใน Google Console การกดปุ่มจะขึ้นกล่องบอก
URL ที่ต้องนำไปเพิ่มให้ตรงตัว เช่น `https://<ลิงก์ปัจจุบัน>/auth/google/callback`
ระหว่างนี้เพื่อนยังสมัคร/เข้าสู่ระบบด้วยอีเมล+รหัสผ่านได้ตามปกติ

ถ้าจะเปิด Google login บนลิงก์ tunnel:

1. ไปที่ Google Cloud Console → APIs & Services → Credentials → OAuth client (Web)
2. เพิ่ม Authorized redirect URI: `https://<โดเมนปัจจุบัน>/auth/google/callback`
   (ลิงก์ trycloudflare เปลี่ยนทุกครั้งที่ tunnel เริ่มใหม่ → ต้องอัปเดต URI ทุกครั้ง
   ถ้าต้องการถาวรต้องใช้ named tunnel + โดเมนของตัวเอง)
3. OAuth consent screen → เปลี่ยนชื่อแอปจาก "Amway Team" เป็น **StudyPath**
   และเพิ่มอีเมลเพื่อนใน Test users
4. ตรวจว่า `GET /auth/google/ready` ตอบ `{"ready":true}` แล้วรีเฟรชหน้า login

หมายเหตุ: บนเครื่องนี้ `http://localhost:3000/auth/google/callback` ลงทะเบียนไว้แล้ว
จึงเห็น `ready:true` เมื่อเปิดผ่าน localhost แต่ลิงก์ tunnel ยังต้องเพิ่มแยก

## ลืมรหัสผ่าน / บัญชีที่สมัครด้วย Google เข้ารหัสไม่ได้

บัญชีที่สมัครผ่าน Google จะมีรหัสผ่านสุ่ม จึงใช้ "อีเมล + รหัสผ่าน" ไม่ได้จนกว่าจะตั้งรหัสใหม่
ให้เจ้าของเครื่องรันสคริปต์นี้ (รหัสผ่านพิมพ์ในหน้าจอ ไม่ถูกบันทึก/ไม่ผ่าน command line):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\set-password.ps1
```

กรอกอีเมล → รหัสผ่านใหม่ 2 ครั้ง → เข้าสู่ระบบด้วยอีเมลนั้นได้ทันที
(ข้อความ error ตอนล็อกอินแยกให้แล้วว่า "ไม่พบบัญชี" หรือ "รหัสผ่านไม่ถูกต้อง")


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
