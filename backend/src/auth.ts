import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { Request, Response, NextFunction } from "express";
import { PrismaClient, Role } from "@prisma/client";
export const prisma = new PrismaClient();

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u || !(await bcrypt.compare(password, u.passwordHash)))
    return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  const token = jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role, themeColor: u.themeColor } });
};

export const requireAuth = (...roles: Role[]) =>
  (req: any, res: Response, next: NextFunction) => {
    try {
      const t = req.headers.authorization?.split(" ")[1];
      req.user = jwt.verify(t!, process.env.JWT_SECRET!);
      if (roles.length && !roles.includes(req.user.role)) return res.sendStatus(403);
      next();
    } catch { res.sendStatus(401); }
  };