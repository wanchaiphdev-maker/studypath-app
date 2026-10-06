# Amway Team App

แอปสำหรับทีม Amway: ภาพรวมยอดขาย, โครงสร้างทีม, แชท realtime, แคตตาล็อกสินค้า

| ส่วน | เทคโนโลยี | ที่อยู่ |
| --- | --- | --- |
| Backend (API + WebSocket) | Express, Prisma, Socket.IO | https://amway-api.onrender.com |
| Database | PostgreSQL (Neon) | `DATABASE_URL` ใน env ของ Render |
| Mobile | Expo / React Native | build ด้วย EAS → APK |
| Repo | GitHub (private) | `wanchaiphdev-maker/amway-app` |
| Keep-alive | UptimeRobot | ping `GET /health` ทุก 5 นาที |

## โครงสร้าง

```
amway-app/
├── render.yaml      # Render Blueprint: build/start command, health check, env var ชื่อ
├── backend/         # API server (port 3000)
│   ├── prisma/      # schema + migrations + seed
│   └── src/
│       ├── index.ts # app + Socket.IO + /health
│       └── routes/  # auth, products, chat, team, sales, me
└── mobile/          # แอปมือถือ (5 แท็บ + หน้าแชท)
```

## ขึ้น Production (ครั้งแรกทำไปแล้ว เผื่อต้องทำซ้ำ)

1. **Database** — สร้าง project บน Neon แล้ว copy connection string (pooled, `?sslmode=require`)
2. **Render** — New Blueprint → เลือก repo นี้ → `render.yaml` จะสร้าง web service `amway-api` ให้เอง
3. **กรอก env vars** ในหน้า Blueprint (ชื่อ key อ่านจาก `render.yaml` ค่าใส่ใน `backend/.env`):
   - `DATABASE_URL`, `JWT_SECRET`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `SEED_PASSWORD`
   - `LK_URL`, `LK_KEY`, `LK_SECRET`
4. **เริ่มข้อมูล** (ครั้งแรกรันจากเครื่องตัวเอง ชี้ `DATABASE_URL` ไปที่ Neon):
   ```
   cd backend
   $env:DATABASE_URL = "<neon url>"
   npx prisma migrate deploy
   npm run db:seed
   ```
   หลังจากนั้น migrate จะรันอัตโนมัติทุกครั้งที่ deploy (ดู `render.yaml` → start command)
5. **ชี้แอปเข้า URL จริง** แล้ว build APK:
   ```
   cd mobile
   eas env:set --name EXPO_PUBLIC_API_URL --value https://amway-api.onrender.com --environment production
   eas build --platform android --profile production
   ```

push ขึ้น `main` = Render deploy ให้เอง (auto-deploy)

## รันในเครื่อง (dev)

```
# backend
cd backend
npm install
npx prisma migrate dev
npm run db:seed
npm run dev            # http://localhost:3000

# mobile (ตั้ง EXPO_PUBLIC_API_URL ใน mobile/.env ชี้ไป backend)
cd mobile
npm install
npx expo start
```

## ทดสอบ

- API: `backend` มีชุดทดสอบ 23 กรณี (permission ข้าม role, FK, validation) — รันได้ทั้ง local และ production
- endpoint สำคัญ: `GET /health` → `{"ok":true,"uptime":...}`

## เข้าสู่ระบบด้วย Google

หน้าล็อกอินมีปุ่ม "เข้าสู่ระบบด้วย Google" — ใครก็ที่มี Gmail กดเข้าได้ทันที
(สมาชิกใหม่ถูกสร้างอัตโนมัติ role = MEMBER จากชื่อ/อีเมลในบัญชี Google)

วิธีทำงาน (Authorization Code Flow):

1. แอปเปิดหน้า consent ของ Google (Chrome) พร้อม `state` = deep link กลับแอป
2. ผู้ใช้กดยินยอม → Google redirect มาที่ `GET /auth/google/callback` ของ backend
3. backend แลก `code` กับ Google (เก็บ `GOOGLE_CLIENT_SECRET` ไว้ฝั่ง server เท่านั้น)
   → สร้าง/หาสมาชิก → ออก JWT ของแอป → redirect กลับแอปพร้อม `?token=`
4. แอบเก็บ token แล้วเข้าสู่ระบบ (token อยู่ใน SecureStore คงอยู่ข้ามการปิดแอป)

ตั้งค่าครั้งแรก (ทำไปแล้ว):

- Google Cloud Console → project `gen-lang-client-0470573019` → Google Auth Platform
  - OAuth consent screen: External, app name "Amway Team", เพิ่ม privacy/terms URL
    (`https://amway-api.onrender.com/privacy`, `/terms`) แล้ว **Publish app → In production**
  - Credentials → OAuth Client ID (Web application) → redirect URI
    `https://amway-api.onrender.com/auth/google/callback`
- env vars:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` → Render (ใน `render.yaml` เป็น `sync: false`)
  - `EXPO_PUBLIC_GOOGLE_CLIENT_ID` → EAS (ทั้ง production/development/preview) + `mobile/.env`
- ฝั่งแอป: `mobile/lib/googleAuth.ts` (สร้าง URL + อ่าน callback), `app/_layout.tsx` (รับ deep link),
  `app/(auth)/login.tsx` (ปุ่ม)

## เข้าสู่ระบบ / สมัครสมาชิก

หน้าล็อกอินมี 4 ช่องทาง: **อีเมล+รหัสผ่าน**, **Google**, **Facebook**, และ **สมัครสมาชิกเอง**

### สมัครสมาชิก (อีเมล)

- `POST /auth/register { name, email, password }` → สร้างสมาชิก role = MEMBER แล้วเข้าสู่ระบบทันที
- ตรวจ: ชื่อต้องมี, อีเมลถูกต้อง + ซ้ำไม่ได้ (409), รหัสผ่าน ≥ 8 ตัวอักษร
- หน้าแอป: `mobile/app/(auth)/register.tsx` (กด "สมัครสมาชิก" จากหน้าล็อกอิน)

### Google / Facebook (OAuth Code Flow)

ทั้งสองใช้รูปแบบเดียวกัน — แอปเปิดหน้ายินยอมในเบราว์เซอร์ → provider redirect มาที่ backend
→ backend แลก `code` (เก็บ secret ฝั่ง server) → สร้าง/หาสมาชิก → ออก JWT → redirect กลับแอป `?token=`

- `GET /auth/google/callback`, `GET /auth/facebook/callback` — รับ redirect จาก provider
- `POST /auth/google { code }`, `POST /auth/facebook { code }` — รุ่น JSON (เผื่อทดสอบ/เว็บ)
- สมาชิกใหม่จาก Google/Facebook ถูกสร้างอัตโนมัติ role = MEMBER (ไม่มีรหัสผ่าน)
- ฝั่งแอป: `mobile/lib/googleAuth.ts`, `mobile/lib/facebookAuth.ts`, `app/_layout.tsx` (รับ deep link)

ตั้งค่า:

- **Google**: Google Cloud → Google Auth Platform → OAuth consent screen (External) +
  Web client → redirect `https://amway-api.onrender.com/auth/google/callback` → Publish app
- **Facebook**: [Meta for Developers](https://developers.facebook.com/) → Create App → เพิ่มผลิตภัณฑ์
  "Facebook Login" → Settings → Valid OAuth Redirect URIs =
  `https://amway-api.onrender.com/auth/facebook/callback` → ตั้ง App เป็น **Live**
  (ต้องมี Privacy Policy URL = `https://amway-api.onrender.com/privacy`)
- env vars:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
    → Render (ใน `render.yaml` เป็น `sync: false`)
  - `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, `EXPO_PUBLIC_FACEBOOK_APP_ID` → EAS (ทุก environment) + `mobile/.env`
  - ถ้า `EXPO_PUBLIC_FACEBOOK_APP_ID` ยังว่าง ปุ่ม Facebook จะซ่อนไว้อัตโนมัติ

## ฟีเจอร์ (อ้างอิง Amway Click)

แอปมี 5 แท็บ: **ทีม | แชท | หน้าหลัก (กลาง) | สินค้า | โปรไฟล์**

### หน้าหลัก
- การ์ดรายได้สะสม (hero) + สถิติ PV/เดือน
- Quick Actions: บันทึกการขาย, เพิ่มลูกค้า, นัดประชุม, แชททีม
- แจ้งเตือน (notifications) — แอดมินสร้างได้
- เป้าหมาย (goals) — ตั้งและติดตามเป้าหมายยอดขาย/สมาชิก
- ยอดรายเดือนพร้อมแถบกราฟ

### โปรไฟล์
- ข้อมูลโปรไฟล์ + ระดับธุรกิจ
- **รายได้ของฉัน** — ยอดส่วนตัว/ทีม (ข้อมูลส่วนตัว)
- **ตั้งค่า** — สีธีม
- **ลูกค้า** — เพิ่ม/ดู/ลบลูกค้า
- **ข่าวสาร/โปรโมชั่น** — ฟีดจากบริษัท
- **กิจกรรม** — ตารางกิจกรรม
- **นัดประชุม** — สร้าง/ดูการนัดประชุม (หัวหน้าทีม/แอดมิน)
- ออกจากระบบ

### สินค้า
- แสดงรายการสินค้า + บันทึกการขาย
- แอดมิน: เพิ่ม/แก้ไข/ลบสินค้า

### ทีม
- รายชื่อสมาชิกในสายงาน + ยอดส่วนตัว/ทีม/PV

### แชท
- ห้องแชทกลุ่ม + คุยตรง

### API endpoints
- `POST /auth/register` — สมัครสมาชิก
- `POST /auth/google`, `POST /auth/facebook` — OAuth
- `GET /me/status` — สถานะ PV/ระดับ/ลูกค้า/เป้าหมาย
- `GET/POST/PATCH/DELETE /customers` — จัดการลูกค้า
- `GET/POST /news` — ข่าวสาร
- `GET/POST /events` — กิจกรรม
- `GET/POST/PATCH/DELETE /goals` — เป้าหมาย
- `GET/POST /notifications` — แจ้งเตือน
- `GET/POST /meetings` — นัดประชุม

## ข้อจำกัดของ tier ฟรี (สำคัญ)

- **Render ฟรี**: 750 ชม./เดือนต่อ workspace และ **หลับเองหลังไม่มีทราฟฟิก 15 นาที**
  (คำขอแรกหลังหลับจะรอ ~50–60 วินาที) → UptimeRobot ping `/health` ทุก 5 นาทีกันหลับ
  ถ้า monitor หยุด = ทุกคนจะเจอหน้าล็อกอินค้างตอนเปิดแอป
- **Render free filesystem เป็น ephemeral** — ไฟล์ที่เขียนลงดิสก์จะหายทุกครั้งที่ deploy/หลับ
  ให้เก็บข้อมูลลง PostgreSQL อย่างเดียว
- **Neon ฟรี**: 0.5 GB, compute มีโควต้ารายเดือน (scale to 0 ตอนไม่มีคนใช้)

## ความลับ

- ค่าจริงทั้งหมดอยู่ใน `backend/.env` และ env ของ Render/EAS — **ห้าม commit**
  (`.gitignore` กัน `**/.env` อยู่แล้ว)
- ห้าม commit `google-services.json`, keystores, หรือ `.env` ทุกชนิด
