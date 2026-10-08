import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const login = async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
    return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  }
  const token = jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  return res.json({ token, user: { id: u.id, name: u.name, role: u.role, themeColor: u.themeColor } });
};

export const register = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อ" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "อีเมลไม่ถูกต้อง" });
  if (password.length < 8) return res.status(400).json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
  if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ error: "อีเมลนี้ถูกใช้งานแล้ว" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: name.slice(0, 80), email, passwordHash, role: "MEMBER" } });
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  return res.status(201).json({ token, user: { id: user.id, name: user.name, role: user.role, themeColor: user.themeColor } });
};

export function requireAuth(roles?: string[]) {
  return (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    try {
      const raw = String(req.headers.authorization || "");
      if (!raw.startsWith("Bearer ")) return res.status(401).json({ error: "ต้องเข้าสู่ระบบ" });
      const payload = jwt.verify(raw.slice(7), process.env.JWT_SECRET!) as any;
      if (roles?.length && !roles.includes(String(payload.role))) return res.status(403).json({ error: "ไม่มีสิทธิ์" });
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: "เซสชันไม่ถูกต้องหรือหมดอายุ" });
    }
  };
}
