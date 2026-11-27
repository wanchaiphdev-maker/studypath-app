# StudyPath — คู่มือใช้งานและดูแล (เครื่องนี้)

## ลิงก์ที่ส่งให้เพื่อน

อ่านจากไฟล์ `LINK.txt` ที่ root ของโปรเจกต์ (อัปเดตอัตโนมัติเมื่อ tunnel เริ่มใหม่)

```
Get-Content .\LINK.txt
```

## เปิดแอปแบบไม่ต้องพิมพ์คำสั่ง

ดับเบิลคลิก **`Start StudyPath.bat`** ที่ root ของโปรเจกต์

- เปิด backend (3000), share server (8090), tunnel และ watchdog ให้อัตโนมัติ
- พิมพ์ลิงก์ public ปัจจุบัน แล้วเปิดในเบราว์เซอร์ให้เลย
- ถ้าเปิดซ้ำ ระบบจะไม่เปิดซ้ำ (idempotent)
- ถ้าไม่ต้องการให้เปิดเบราว์เซอร์: `Start StudyPath.bat --no-open`

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

## อัปโหลดไฟล์เนื้อหา (PDF / สไลด์ / เอกสาร / รูปภาพ / เสียง)

- ชนิดที่รองรับ: **PDF, PPTX, DOCX, XLSX, TXT/MD/CSV/JSON, รูปภาพ (PNG/JPG/WEBP), เสียง/วิดีโอ**
- ขนาดสูงสุด **25MB** ต่อไฟล์ (ไฟล์ที่ต้องให้ AI อ่าน เช่น เสียง/รูปภาพ/PDF สแกน ต้องไม่เกิน 14MB)
- PDF/PPTX/DOCX/XLSX/TXT อ่านข้อความในเครื่อง (ไม่กินโควตา AI)
- รูปภาพ + PDF สแกน + เสียง/วิดีโอ ใช้ **Gemini native** (`generateContent` + `inlineData`)
  - เดิมยิง `/audio/transcriptions` ของ OpenAI-compat ซึ่ง Gemini ไม่มี → 404
  - ถ้ามี OpenAI/Whisper ตั้งใน `backend/.env` ระบบจะเลือก Whisper ก่อน:
    `AI_TRANSCRIBE_BASE_URL=https://api.openai.com/v1`, `AI_TRANSCRIBE_API_KEY=...`, `AI_TRANSCRIBE_MODEL=whisper-1`
  - เปลี่ยนโมเดลได้ที่ `GEMINI_TRANSCRIBE_MODEL` (ค่าเริ่มต้นใช้ `AI_MODEL`)
- ไฟล์ `.ppt/.doc/.xls` รุ่นเก่าไม่รองรับ → บันทึกเป็น `.pptx/.docx/.xlsx` หรือ PDF ก่อน
- ไฟล์ที่อัปโหลดถูกเก็บที่ `backend/storage/materials` (ลบไฟล์ที่อัปโหลดไม่สำเร็จได้)
- ในหน้ารายวิชา ไฟล์ที่ผู้ใช้อัปโหลด/อัดเสียงเองจะอยู่ส่วน **"ไฟล์ที่อัปโหลด"** แยกเป็นรายไฟล์
  (เรียงใหม่สุดก่อน) ส่วนเนื้อหาจาก Google Classroom ยังอยู่ในหมวดเดิม
- การอัดเสียง: เว็บได้ `.webm` มือถือได้ `.m4a` — เซิร์ฟเวอร์ตรวจชนิดจากไบต์จริงก่อนส่งให้ AI

## Google Login (ขั้นตอนใน Google Cloud Console)

ปุ่ม **"เข้าสู่ระบบด้วย Google" แสดงตลอด** (เดิมซ่อนเมื่อยังตั้งค่าไม่ครบ ทำให้ผู้ใช้คิดว่าปุ่มหาย)
ถ้ายังไม่ได้ลงทะเบียน redirect URI ของลิงก์นี้ใน Google Console หน้า login จะแสดง URL ที่ต้องเพิ่มให้ตรงตัว
เช่น `https://<ลิงก์ปัจจุบัน>/auth/google/callback` พร้อมปุ่ม **"ตรวจอีกครั้ง"**
ระหว่างนี้เพื่อนยังสมัคร/เข้าสู่ระบบด้วยอีเมล+รหัสผ่านได้ตามปกติ

ขั้นตอนเปิด Google login สำหรับลิงก์ใหม่ (ทำครั้งเดียวต่อลิงก์):

1. เปิด https://console.cloud.google.com/apis/credentials?project=723288106952
2. หัวข้อ **OAuth 2.0 Client IDs** → คลิกชื่อ client ชนิด **Web application** → ดินสอ (Edit)
3. **Authorized redirect URIs** → `+ ADD URI` → วาง `https://<ลิงก์ปัจจุบัน>/auth/google/callback`
   (ไม่มี `/` ปิดท้าย) → **SAVE** — รอ 1-2 นาทีให้ Google อัปเดต
4. กลับมาที่หน้า login ของแอป → กด **"ตรวจอีกครั้ง"** ใต้ปุ่ม Google
   (ปุ่มนี้เรียก `/auth/google/ready?refresh=1` จึงข้ามแคช 5 นาที ไม่ต้องรีสตาร์ท backend)
   - ขึ้น "พร้อมแล้ว" → กดปุ่ม Google ได้เลย
   - ยังไม่พร้อม → ตรวจว่า URI วางในช่อง Authorized **redirect** URIs (ไม่ใช่ JavaScript origins) และ Save แล้ว
5. **Google Auth Platform → Branding**: ตั้งชื่อแอปเป็น **StudyPath** (เดิม amwayTeam/Amway Team)
6. **Audience**: ถ้า Publishing status = Testing ให้เพิ่มอีเมล Google ของคนที่จะล็อกอินใน **Test users**
   (ไม่เพิ่ม → Google ขึ้น "Access blocked: … has not completed the verification process")
7. **Data Access**: ต้องมี scope `openid`, `email`, `profile`,
   `classroom.courses.readonly`, `classroom.courseworkmaterials.readonly`,
   `classroom.coursework.me.readonly`, `classroom.coursework.students.readonly`,
   `classroom.announcements.readonly`, `drive.readonly`

หมายเหตุ:

- Client นี้เป็นชนิด **Web application** (ตรวจแล้ว: localhost พอร์ตอื่นถูกปฏิเสธ) จึงใช้ลิงก์ tunnel ได้
- `http://localhost:3000/auth/google/callback` ลงทะเบียนไว้แล้ว → เปิดผ่าน localhost ได้เลย
  แต่ `http://127.0.0.1:3000/...` ยังไม่ลงทะเบียน (แนะนำให้เพิ่มด้วยถ้าจะเปิดผ่าน 127.0.0.1)
- ลิงก์ trycloudflare **เปลี่ยนทุกครั้งที่ cloudflared เริ่มใหม่** (watchdog จะรีสตาร์ท tunnel ให้ถ้าตาย
  แล้วเขียน `LINK.txt` ใหม่) → ต้องเพิ่ม URI ใหม่ทุกครั้ง
  ถ้าต้องการถาวร: ใช้ named tunnel + โดเมนของตัวเอง หรือ ngrok static domain แล้วลงทะเบียน URI นั้นครั้งเดียว
- โหมด Testing: refresh token ของ Google หมดอายุใน ~7 วัน → ต้องกดเชื่อม Classroom ใหม่เป็นระยะ
  (ถ้าอยากให้ถาวรต้องผ่านการ verification ของ Google ซึ่งใช้เวลาหลายสัปดาห์)

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
