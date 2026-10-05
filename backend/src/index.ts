import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { AccessToken } from "livekit-server-sdk";
import { prisma, login, requireAuth } from "./auth";
import sales from "./routes/sales";
import team from "./routes/team";
import contest from "./routes/contest";
import meetings from "./routes/meeting";
import products from "./routes/products";
import chat from "./routes/chat";
import { canAccessRoom } from "./services/access";

const app = express(); app.use(cors(), express.json());

// health check สำหรับ Render (ใช้ตอน deploy และตอนโหลดเย็น)
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.post("/auth/login", login);
app.use("/sales", sales);
app.use("/team", team);
app.use("/contest", contest);
app.use("/meetings", meetings);
app.use("/products", products);
app.use("/chat", chat);

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