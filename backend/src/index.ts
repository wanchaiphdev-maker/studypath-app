import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { AccessToken } from "livekit-server-sdk";
import { prisma, login, register, googleLogin, googleCallback, facebookLogin, facebookCallback, requireAuth } from "./auth";
import sales from "./routes/sales";
import team from "./routes/team";
import contest from "./routes/contest";
import meetings from "./routes/meeting";
import products from "./routes/products";
import chat from "./routes/chat";
import customers from "./routes/customers";
import news from "./routes/news";
import events from "./routes/events";
import goals from "./routes/goals";
import notifications from "./routes/notifications";
import { canAccessRoom } from "./services/access";

const app = express(); app.use(cors(), express.json());

// health check สำหรับ Render (ใช้ตอน deploy และตอนโหลดเย็น)
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.post("/auth/login", login);
app.post("/auth/register", register);
app.post("/auth/google", googleLogin);
app.get("/auth/google/callback", googleCallback);
app.post("/auth/facebook", facebookLogin);
app.get("/auth/facebook/callback", facebookCallback);

// หน้า Privacy Policy / Terms สำหรับใช้เป็น URL ยืนยันใน Google OAuth consent screen
const legalPage = (title: string, body: string) => `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Amway Team</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.7;color:#0f172a;background:#f8fafc;margin:0;padding:32px 20px}
main{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:26px 0 6px}
p,li{font-size:15px;color:#334155}small{color:#64748b}
</style></head><body><main>
<h1>${title}</h1><small>ปรับปรุงล่าสุด: 5 ตุลาคม 2569 (2026)</small>
${body}
<p><small>แอป Amway Team</small></p>
</main></body></html>`;

app.get("/privacy", (_req, res) => res.type("html").send(legalPage("นโยบายความเป็นส่วนตัว", `
<p>แอป Amway Team เก็บและใช้ข้อมูลของคุณดังต่อไปนี้</p>
<h2>ข้อมูลที่เก็บ</h2>
<ul>
<li><b>ข้อมูลที่คุณบันทึกเอง</b> เช่น ชื่อ อีเมล เลขที่สมาชิก ข้อมูลการขาย และข้อความในแชท</li>
<li><b>อีเมลและชื่อจากบัญชี Google</b> ใช้สำหรับเข้าสู่ระบบเท่านั้น เมื่อคุณกด "เข้าสู่ระบบด้้วย Google"</li>
<li><b>รูปโปรไฟล์ (ถ้ามี)</b> จากบัญชี Google ของคุณ</li>
</ul>
<h2>วัตถุประสงค์</h2>
<p>ใช้เพื่อให้แอปทำงานได้แก่ แสดงสินค้า ยอดขาย ตารางทีม การประชุมทางวิดีโอ และแชทภายในทีมเท่านั้น</p>
<h2>การแชร์ข้อมูล</h2>
<p>เราไม่ขายข้อมูลของคุณ ข้อมูลถูกเก็บบนเซิร์ฟเวอร์ที่เราดูแล (Render) และฐานข้อมูล PostgreSQL (Neon) ซึ่งเข้ารหัสขณะส่งข้อมูล</p>
<h2>การลบข้อมูล</h2>
<p>หากต้องการให้ลบบัญชีและข้อมูลทั้งหมด ติดต่อแอดมินของทีมคุณ</p>
`)));

app.get("/terms", (_req, res) => res.type("html").send(legalPage("ข้อกำหนดการใช้งาน", `
<h2>การใช้งาน</h2>
<p>แอปนี้จัดทำสำหรับสมาชิกในทีมเพื่อใช้บริหารงานขายและประสานงานภายในทีม</p>
<h2>บัญชีของคุณ</h2>
<p>คุณรับผิดชอบต่อการเข้าสู่ระบบของตุณเอง และต้องไม่แชร์รหัสผ่านหรือบัญชีให้ผู้อื่น</p>
<h2>ข้อมูลที่ถูกต้อง</h2>
<p>ข้อมูลยอดขายและรายได้ที่บันทึกในแอปควรเป็นข้อมูลจริง เพื่อผลประโยชน์ของตัวคุณและทีม</p>
<h2>การเปลี่ยนแปลง</h2>
<p>เราอาจปรับปรุงข้อกำหนดเหล่านี้ได้ และจะแจ้งให้ทราบในแอป</p>
`)));

app.use("/sales", sales);
app.use("/team", team);
app.use("/contest", contest);
app.use("/meetings", meetings);
app.use("/products", products);
app.use("/chat", chat);
app.use("/customers", customers);
app.use("/news", news);
app.use("/events", events);
app.use("/goals", goals);
app.use("/notifications", notifications);

// โปรไฟล์ของตัวเอง
app.get("/me", requireAuth(), async (req: any, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true, themeColor: true, avatarUrl: true, groupId: true },
  });
  if (!user) return res.sendStatus(404);
  res.json(user);
});

app.patch("/me", requireAuth(), async (req: any, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const themeColor = typeof req.body?.themeColor === "string" ? req.body.themeColor.trim() : "";
  const data: Record<string, string> = {};
  if (name) data.name = name;
  if (themeColor) {
    if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) return res.status(400).json({ error: "รูปแบบสีไม่ถูกต้อง" });
    data.themeColor = themeColor;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: "ไม่มีข้อมูลที่จะแก้" });

  await prisma.user.update({ where: { id: req.user.id }, data });
  res.json(await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true, themeColor: true, avatarUrl: true, groupId: true },
  }));
});

// สถานะธุรกิจของฉัน: ระดับ + PV ส่วนตัว/ทีม + ลูกค้า + เป้าหมาย
app.get("/me/status", requireAuth(), async (req: any, res) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const [user, customerCount, goalCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.user.id },
      select: { rank: true, role: true, name: true },
    }),
    prisma.customer.count({ where: { ownerId: req.user.id } }),
    prisma.goal.count({ where: { userId: req.user.id } }),
  ]);
  const personal = await prisma.sale.aggregate({
    where: { userId: req.user.id, date: { gte: from } },
    _sum: { totalPV: true, totalAmount: true },
  });
  res.json({
    rank: user?.rank ?? "สมาชิก",
    role: user?.role,
    personalPV: Number(personal._sum.totalPV ?? 0),
    personalAmount: Number(personal._sum.totalAmount ?? 0),
    customerCount,
    goalCount,
  });
});

// LiveKit token (วิดีโอ/เสียง/ประชุม)
app.get("/call/token", requireAuth(), async (req: any, res) => {
  const roomId = String(req.query.room ?? "");
  if (!roomId || !(await canAccessRoom(req.user.id, req.user.role, roomId))) {
    return res.sendStatus(403);
  }

  const at = new AccessToken(process.env.LK_KEY!, process.env.LK_SECRET!, { identity: req.user.id });
  at.addGrant({ room: roomId, roomJoin: true });
  res.json({ token: await at.toJwt(), url: process.env.LK_URL });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
io.use((s, next) => { try { s.data.user = jwt.verify(s.handshake.auth.token, process.env.JWT_SECRET!); next(); }
  catch { next(new Error("unauthorized")); } });
io.on("connection", s => {
  s.on("join", async (roomId: string) => {
    if (typeof roomId === "string" && await canAccessRoom(s.data.user.id, s.data.user.role, roomId)) {
      await s.join(roomId);
    }
  });
  s.on("msg", async (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { roomId, text } = payload as { roomId?: unknown; text?: unknown };
    if (typeof roomId !== "string" || typeof text !== "string" || !text.trim() || text.length > 4000) return;
    if (!(await canAccessRoom(s.data.user.id, s.data.user.role, roomId))) return;

    const message = await prisma.message.create({
      data: { roomId, text: text.trim(), senderId: s.data.user.id },
    });
    io.to(roomId).emit("msg", message);
  });
});
server.listen(process.env.PORT || 3000);