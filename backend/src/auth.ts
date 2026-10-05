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

/** สมัครสมาชิกเอง (อีเมล + รหัสผ่าน) → เข้าสู่ระบบทันที */
export const register = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อ" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "อีเมลไม่ถูกต้อง" });
  if (password.length < 8) return res.status(400).json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "อีเมลนี้ถูกใช้งานแล้ว" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: name.slice(0, 80), email, passwordHash, role: "MEMBER" },
  });
  console.log("[auth:register] สมาชิกใหม่:", email);
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  res.status(201).json({ token, user: { id: user.id, name: user.name, role: user.role, themeColor: user.themeColor } });
};

/** ถอด payload ออกจาก id_token ของ Google (ตรวจ iss/aud/exp เองด้านล่าง) */
function decodeIdToken(idToken: string): Record<string, any> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("รูปแบบ id_token ไม่ถูกต้อง");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

class GoogleAuthError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * แลก authorization code กับ Google แล้วสร้าง/หาสมาชิก → ออก JWT ของแอปเรา
 * secret ถูกเก็บไว้ฝั่งเซิร์ฟเวอร์เท่านั้น (Authorization Code Flow)
 */
async function signInWithGoogle(code: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[auth:google] ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
    throw new GoogleAuthError(500, "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Google login");
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "";
  const redirectTo = `${baseUrl.replace(/\/$/, "")}/auth/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectTo,
      grant_type: "authorization_code",
    }),
  });
  const tokens: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) {
    console.error("[auth:google] token exchange failed:", tokenRes.status, JSON.stringify(tokens).slice(0, 300));
    throw new GoogleAuthError(401, "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่");
  }

  const profile = decodeIdToken(String(tokens.id_token));
  const now = Math.floor(Date.now() / 1000);
  const audOk = profile.aud === clientId || (Array.isArray(profile.aud) && profile.aud.includes(clientId));
  if (!GOOGLE_ISSUERS.includes(String(profile.iss)) || !audOk || Number(profile.exp) < now) {
    console.error("[auth:google] token ไม่ผ่านการตรวจสอบ", { iss: profile.iss, aud: profile.aud });
    throw new GoogleAuthError(401, "ยืนยันตัวตนกับ Google ไม่สำเร็จ");
  }

  const email = String(profile.email || "").toLowerCase();
  if (!email) throw new GoogleAuthError(401, "บัญชี Google นี้ไม่มีอีเมล");

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // สมาชิกใหม่: สร้างให้อัตโนมัติ (ไม่มีรหัสผ่าน — เข้าได้เฉพาะผ่าน Google เท่านั้น)
    const name = String(profile.name || email.split("@")[0]).slice(0, 80);
    const placeholderHash = await bcrypt.hash(`google:${email}:${Date.now()}`, 10);
    user = await prisma.user.create({
      data: { email, name, passwordHash: placeholderHash, role: "MEMBER", avatarUrl: String(profile.picture || "") || null },
    });
    console.log("[auth:google] สร้างสมาชิกใหม่:", email);
  } else if (!user.avatarUrl && profile.picture) {
    user = await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: String(profile.picture) } });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  return { token, user: { id: user.id, name: user.name, role: user.role, themeColor: user.themeColor } };
}

/** POST /auth/google { code } → JSON (ใช้ตอนทดสอบหรือฝั่งเว็บ) */
export const googleLogin = async (req: Request, res: Response) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) return res.status(400).json({ error: "ไม่ได้รับ authorization code จาก Google" });
  try {
    res.json(await signInWithGoogle(code));
  } catch (cause) {
    const err = cause instanceof GoogleAuthError ? cause : new GoogleAuthError(500, "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
    if (!(cause instanceof GoogleAuthError)) console.error("[auth:google] unexpected:", cause);
    res.status(err.status).json({ error: err.message });
  }
};

/** อนุญาตให้ redirect กลับไปที่แอปได้เฉพาะ deep link ของแอปเราเท่านั้น (กัน open redirect) */
function safeReturnUrl(state: string): string | null {
  if (!state || state.length > 300) return null;
  let target: URL;
  try {
    target = new URL(state);
  } catch {
    return null;
  }
  const scheme = target.protocol.replace(/:$/, "");
  if (scheme === "mobile") {
    // APK จริง: mobile:///login (app.json scheme = "mobile")
    return target.pathname === "/login" || target.host === "login" ? state : null;
  }
  if (scheme === "exp" || scheme === "exps") {
    // ตอนพัฒนาด้วย Expo Go: exp://<ip>:8082/--/login
    return target.pathname === "/--/login" ? state : null;
  }
  return null;
}

/**
 * GET /auth/google/callback — Google จะเรียก URL นี้จากเบราว์เซอร์ในเครื่องผู้ใช้
 * แลก code → สร้างสมาชิก → redirect กลับไปที่แอปพร้อม token
 */
export const googleCallback = async (req: Request, res: Response) => {
  const code = String(req.query.code || "");
  const back = safeReturnUrl(String(req.query.state || ""));
  const withParams = (params: Record<string, string>) =>
    back ? `${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams(params)}` : null;

  const fail = (message: string) => {
    const redirect = withParams({ error: message });
    if (redirect) return res.redirect(302, redirect);
    console.error("[auth:google] callback fail:", message);
    return res.status(400).type("html").send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">
       <h2>เข้าสู่ระบบด้วย Google ไม่สำเร็จ</h2><p>${message}</p><p>ปิดหน้านี้แล้วลองใหม่จากแอปได้เลย</p>`,
    );
  };

  if (!code) return fail("ไม่ได้รับ authorization code จาก Google");
  try {
    const { token } = await signInWithGoogle(code);
    const redirect = withParams({ token });
    if (!redirect) return fail("ลิงก์กลับแอปไม่ถูกต้อง (state)");
    return res.redirect(302, redirect);
  } catch (cause) {
    const err = cause instanceof GoogleAuthError ? cause : new GoogleAuthError(500, "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
    if (!(cause instanceof GoogleAuthError)) console.error("[auth:google] unexpected:", cause);
    return fail(err.message);
  }
};

const FACEBOOK_API_VERSION = "v19.0";

/** แลก code กับ Facebook → หา/สร้างสมาชิก → ออก JWT (secret อยู่ฝั่ง server) */
async function signInWithFacebook(code: string) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    console.error("[auth:facebook] ยังไม่ได้ตั้งค่า FACEBOOK_APP_ID / FACEBOOK_APP_SECRET");
    throw new GoogleAuthError(500, "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Facebook login");
  }
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "";
  const redirectTo = `${baseUrl.replace(/\/$/, "")}/auth/facebook/callback`;

  const tokenRes = await fetch(
    `https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token?` +
      `client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}` +
      `&redirect_uri=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`,
  );
  const tokens: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.access_token) {
    console.error("[auth:facebook] token exchange failed:", tokenRes.status, JSON.stringify(tokens).slice(0, 300));
    throw new GoogleAuthError(401, "เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ กรุณาลองใหม่");
  }

  const profileRes = await fetch(
    `https://graph.facebook.com/${FACEBOOK_API_VERSION}/me?fields=id,name,email,picture&access_token=${encodeURIComponent(tokens.access_token)}`,
  );
  const profile: any = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok || !profile.id) {
    console.error("[auth:facebook] profile fetch failed:", profileRes.status, JSON.stringify(profile).slice(0, 300));
    throw new GoogleAuthError(401, "ดึงข้อมูลโปรไฟล์ Facebook ไม่สำเร็จ");
  }

  const email = String(profile.email || "").toLowerCase() || `${profile.id}@facebook.local`;
  const name = String(profile.name || "สมาชิก Facebook").slice(0, 80);
  const avatar = profile.picture?.data?.url ? String(profile.picture.data.url) : null;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const placeholderHash = await bcrypt.hash(`facebook:${profile.id}:${Date.now()}`, 10);
    user = await prisma.user.create({
      data: { email, name, passwordHash: placeholderHash, role: "MEMBER", avatarUrl: avatar },
    });
    console.log("[auth:facebook] สร้างสมาชิกใหม่:", email);
  } else if (!user.avatarUrl && avatar) {
    user = await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: avatar } });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  return { token, user: { id: user.id, name: user.name, role: user.role, themeColor: user.themeColor } };
}

/** POST /auth/facebook { code } → JSON */
export const facebookLogin = async (req: Request, res: Response) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) return res.status(400).json({ error: "ไม่ได้รับ authorization code จาก Facebook" });
  try {
    res.json(await signInWithFacebook(code));
  } catch (cause) {
    const err = cause instanceof GoogleAuthError ? cause : new GoogleAuthError(500, "เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ");
    if (!(cause instanceof GoogleAuthError)) console.error("[auth:facebook] unexpected:", cause);
    res.status(err.status).json({ error: err.message });
  }
};

/** GET /auth/facebook/callback — Facebook redirect มาหลังผู้ใช้ยินยอม → redirect กลับแอปพร้อม token */
export const facebookCallback = async (req: Request, res: Response) => {
  const code = String(req.query.code || "");
  const back = safeReturnUrl(String(req.query.state || ""));
  const withParams = (params: Record<string, string>) =>
    back ? `${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams(params)}` : null;

  const fail = (message: string) => {
    const redirect = withParams({ error: message });
    if (redirect) return res.redirect(302, redirect);
    console.error("[auth:facebook] callback fail:", message);
    return res.status(400).type("html").send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">
       <h2>เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ</h2><p>${message}</p><p>ปิดหน้านี้แล้วลองใหม่จากแอปได้เลย</p>`,
    );
  };

  if (!code) return fail("ไม่ได้รับ authorization code จาก Facebook");
  try {
    const { token } = await signInWithFacebook(code);
    const redirect = withParams({ token });
    if (!redirect) return fail("ลิงก์กลับแอปไม่ถูกต้อง (state)");
    return res.redirect(302, redirect);
  } catch (cause) {
    const err = cause instanceof GoogleAuthError ? cause : new GoogleAuthError(500, "เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ");
    if (!(cause instanceof GoogleAuthError)) console.error("[auth:facebook] unexpected:", cause);
    return fail(err.message);
  }
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