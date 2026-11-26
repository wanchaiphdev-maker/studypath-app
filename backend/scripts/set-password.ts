/**
 * ตั้ง/รีเซ็ตรหัสผ่านให้บัญชีหนึ่ง (ใช้เมื่อลืมรหัส หรือบัญชีที่สมัครผ่าน Google)
 *
 * รับข้อมูลทาง stdin เป็น JSON: { "email": "...", "password": "..." }
 * เพื่อไม่ให้รหัสผ่านไปโผล่ใน command line / process list / log
 *
 * ใช้ผ่าน tools/set-password.ps1 (แนะนำ) หรือ:
 *   '{"email":"a@b.c","password":"..."}' | node node_modules/ts-node/dist/bin.js scripts/set-password.ts
 */
import "dotenv/config";
import fs from "fs";
import bcrypt from "bcrypt";
import { prisma } from "../src/auth";

(async () => {
  let payload: any = {};
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    console.error("อ่านข้อมูลไม่ถูกต้อง (ต้องเป็น JSON)");
    process.exit(1);
  }
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  if (!email || !password) {
    console.error("ต้องระบุอีเมลและรหัสผ่าน");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("ไม่พบบัญชี: " + email);
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  console.log("ตั้งรหัสผ่านใหม่ให้ " + email + " เรียบร้อย — เข้าสู่ระบบด้วยอีเมลนี้ได้เลย");
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error?.message || error);
  process.exit(1);
});
