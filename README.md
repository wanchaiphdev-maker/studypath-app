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
