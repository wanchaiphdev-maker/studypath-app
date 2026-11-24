import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma, login, register, requireAuth } from "./auth";
import studypath from "./routes/studypath";
import googleAuth from "./routes/google";
import classroom from "./routes/classroom";
import tutor from "./routes/tutor";
import { startAutosync } from "./autosync";
import { startEmbeddingWorker } from "./lib/embeddings";

const app = express();
const allowedOrigin = process.env.CORS_ORIGIN?.trim();

// กันเซิร์ฟเวอร์ตายทั้งตัวจาก error ที่หลุดออกมา (เช่น promise ใน autosync/interval)
// ถ้าไม่ดักไว้ ผู้ใช้ทุกคนจะโดน "เชื่อมต่อไม่สำเร็จ" จนกว่าจะมีคนมารีสตาร์ท
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error?.message || error);
});

app.use(cors({ origin: allowedOrigin ? allowedOrigin.split(",").map((x) => x.trim()) : true }));
app.use(express.json({ limit: "2mb" }));
app.disable("x-powered-by");
app.use((_req, res, next) => {
  // API เป็นข้อมูลสดรายผู้ใช้ — ห้ามให้เบราว์เซอร์แคชแล้วตอบ 304
  // (fetch ฝั่งแอปถือว่า 304 = ไม่ ok ทำให้ข้อมูลทั้งหน้าหาย เช่น "ยังไม่ได้เข้าสู่ระบบ")
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "StudyPath API", uptime: process.uptime() }));

app.post("/auth/login", login);
app.post("/auth/register", register);
app.use("/auth", googleAuth);

const legalPage = (title: string, body: string) => `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - StudyPath</title><style>body{font-family:system-ui;line-height:1.7;color:#0f172a;background:#f8fafc;margin:0;padding:32px 20px}main{max-width:760px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px}h1{font-size:22px}h2{font-size:17px;margin-top:26px}p,li{color:#334155}</style></head>
<body><main><h1>${title}</h1><small>StudyPath · Personal Learning OS</small>${body}</main></body></html>`;

app.get("/privacy", (_req, res) => res.type("html").send(legalPage("นโยบายความเป็นส่วนตัว", `
<p>StudyPath ใช้ข้อมูลบัญชีและข้อมูลการเรียนที่ผู้ใช้สร้างขึ้นเพื่อให้บริการการเรียนรู้ส่วนบุคคล</p>
<h2>ข้อมูลการเรียน</h2><p>ได้แก่ วิชา เอกสาร แบบทดสอบ ผลการเรียน ตารางอ่านหนังสือ และเนื้อหาที่ผู้ใช้โพสต์ในชุมชน</p>
<h2>AI Tutor</h2><p>คำตอบของ AI ถูกออกแบบให้ยึดหลักฐานจากเอกสารการเรียนที่มีอยู่ และควรตรวจสอบกับแหล่งเรียนรู้ของมหาวิทยาลัย</p>
<h2>การลบข้อมูล</h2><p>ข้อมูลบัญชีและข้อมูลการเรียนสามารถลบหรือจัดการผ่านผู้ดูแลระบบของบริการตามนโยบายที่ประกาศ</p>`)));

app.get("/terms", (_req, res) => res.type("html").send(legalPage("ข้อกำหนดการใช้งาน", `
<h2>การใช้งาน</h2><p>StudyPath เป็นระบบช่วยจัดการการเรียนรู้สำหรับนักศึกษาและบุคลากรทางการศึกษา</p>
<h2>ความถูกต้อง</h2><p>ผู้ใช้รับผิดชอบต่อเอกสารและข้อมูลที่อัปโหลด และควรตรวจสอบคำตอบจาก AI ก่อนนำไปใช้ในการเรียนหรือการประเมิน</p>
<h2>ชุมชน</h2><p>โพสต์และความคิดเห็นต้องเกี่ยวข้องกับการศึกษาและเคารพผู้ใช้อื่น</p>`)));

app.use("/studypath", studypath);
app.use("/studypath/classroom", classroom);
app.use("/studypath/tutor", tutor);

app.get("/me", requireAuth(), async (req: any, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true, themeColor: true, avatarUrl: true },
  });
  if (!user) return res.sendStatus(404);
  res.json(user);
});

app.patch("/me", requireAuth(), async (req: any, res) => {
  const data: Record<string, string> = {};
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
  const themeColor = typeof req.body?.themeColor === "string" ? req.body.themeColor.trim() : "";
  if (name) data.name = name;
  if (themeColor) {
    if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) return res.status(400).json({ error: "รูปแบบสีไม่ถูกต้อง" });
    data.themeColor = themeColor;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: "ไม่มีข้อมูลที่จะแก้" });
  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json(await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, role: true, themeColor: true, avatarUrl: true } }));
});

app.get("/me/learning", requireAuth(), async (req: any, res) => {
  const [subjects, progress, dueReviews, planner] = await Promise.all([
    prisma.subject.count({ where: { userId: req.user.id } }),
    prisma.learningProgress.findMany({ where: { userId: req.user.id }, orderBy: { lastActive: "desc" }, take: 10 }),
    prisma.reviewCard.count({ where: { userId: req.user.id, dueAt: { lte: new Date() } } }),
    prisma.plannerTask.count({ where: { userId: req.user.id, completed: false } }),
  ]);
  res.json({ subjects, progress, dueReviews, planner });
});

// API ที่ไม่รู้จักต้องตอบ JSON ไม่ใช่หน้า HTML ของ Express
app.use((req, res, next) => {
  if (!/^\/(studypath|auth|me|health)(\/|$)/.test(req.path)) return next();
  res.status(404).json({ error: "ไม่พบ API นี้: " + req.method + " " + req.path });
});

// error handler กลาง: ตอบ JSON ที่ฝั่งแอป parse ได้เสมอ (ไม่ปล่อยหน้า HTML 500 กลับไป)
app.use((err: any, req: any, res: any, _next: any) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  console.error("[api]", req.method, req.originalUrl, "→", err?.message || err);
  if (res.headersSent) {
    try { res.end(); } catch { /* ปิดไปแล้ว */ }
    return;
  }
  res.status(status >= 400 && status <= 599 ? status : 500).json({
    error: String(err?.message || "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์"),
  });
});

const server = app.listen(process.env.PORT || 3000);
// ค่า default ของ Node (5 วิ) สั้นกว่า proxy/tunnel (60-90 วิ) → proxy อาจหยิบ connection
// ที่เพิ่งปิดไปแล้วมาใช้ = เจอ 502/คำขอหลุดเป็นครั้งคราว ต้องตั้งให้ยาวกว่าฝั่ง proxy
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

// ซิงก์ Google Classroom อัตโนมัติ (ดึงเป็นระยะ เพราะ Classroom ไม่มี webhook)
if (process.env.AUTOSYNC_ENABLED !== "false") {
  startAutosync();
}

// เติมเวกเตอร์ให้เนื้อหาที่เพิ่งซิงก์/ยังไม่มี embedding เพื่อให้ค้นด้วยความหมายได้
startEmbeddingWorker();
