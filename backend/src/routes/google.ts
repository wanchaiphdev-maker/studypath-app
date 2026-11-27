import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma, requireAuth } from "../auth";
import { runAutosyncForUser } from "../autosync";

const router = Router();
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

/** host ที่ผู้ใช้เปิดอยู่จริง — รองรับทั้ง localhost และโดเมนที่แชร์ผ่าน proxy/tunnel */
function requestHost(req: any) {
  return String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").split(",")[0].trim();
}

function requestBase(req: any) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || req?.protocol || "http").split(",")[0].trim();
  const host = requestHost(req);
  const isLocal = !host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const env = process.env.PUBLIC_BASE_URL?.trim();
  // PUBLIC_BASE_URL มีไว้เป็นค่าตั้งต้นของเครื่องนี้ (local) เท่านั้น
  // ถ้าผู้ใช้เข้าผ่านโดเมนจริง/ลิงก์แชร์ ต้องใช้ host ที่เขาเปิด เพื่อให้ redirect_uri ตรงกับที่ลงทะเบียนไว้
  if (isLocal && env) return env.replace(/\/$/, "");
  return `${proto}://${host || `localhost:${process.env.PORT || 3000}`}`;
}

function redirectUri(req?: any) {
  return requestBase(req) + "/auth/google/callback";
}

/* ------------------------------------------------------------------ */
/*  ตรวจว่า redirect URI ของโดเมนนี้ลงทะเบียนใน Google Console แล้วหรือยัง */
/*  Google เป็นผู้บังคับ (security) — โค้ดเดาแทนไม่ได้ แต่เช็กให้ผู้ใช้ได้    */
/*  ถ้าลงทะเบียนแล้ว Google จะพาไปหน้า sign-in (ไม่ใช่หน้า error)           */
/*  ผลลัพธ์แคช 5 นาที เพื่อไม่ยิง Google ทุกครั้งที่เปิดหน้า login          */
/* ------------------------------------------------------------------ */
const readyCache = new Map<string, { ready: boolean; at: number }>();

async function googleRedirectReady(req: any, force = false) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return false;
  const uri = redirectUri(req);
  const cached = force ? undefined : readyCache.get(uri);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.ready;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: uri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(GOOGLE_AUTH + "?" + params.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "StudyPath/1.0 (+oauth-readiness-check)" },
    });
    const location = String(response.headers.get("location") || "");
    // Google ตอบ 302 ไป /signin/oauth/error เมื่อ redirect URI ไม่ตรงกับที่ลงทะเบียน
    const ready = response.status < 400 && !/signin\/oauth\/error|oauth\/error/i.test(location);
    readyCache.set(uri, { ready, at: Date.now() });
    return ready;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function safeReturnUrl(value: string, req?: any) {
  try {
    const u = new URL(value);
    if (["exp:", "mobile:", "studypath:"].includes(u.protocol)) return true;
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const allowed = new Set(["localhost", "127.0.0.1"]);
    for (const h of String(process.env.APP_ALLOWED_HOSTS || "").split(",")) {
      const v = h.trim().toLowerCase();
      if (v) allowed.add(v);
    }
    // โดเมนที่ผู้ใช้กำลังเปิดแอปอยู่นี้เอง (เช่นลิงก์ที่แชร์) — ไม่ใช่ปลายทางภายนอกที่เดามั่ว
    const host = requestHost(req).toLowerCase();
    if (host) { allowed.add(host); allowed.add(host.split(":")[0]); }
    return allowed.has(u.hostname.toLowerCase()) || allowed.has(u.host.toLowerCase());
  } catch {
    return false;
  }
}

/** ปลายทางกลับหน้าเว็บเมื่อ state ใช้ไม่ได้ — ต้องไม่ใช่ localhost บนเครื่องผู้ใช้ที่เข้าผ่านลิงก์แชร์ */
function fallbackReturnUrl(req?: any) {
  const env = process.env.EXPO_PUBLIC_APP_RETURN_URL?.trim();
  if (env) return env;
  const host = requestHost(req);
  const isLocal = !host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  if (isLocal) return "http://localhost:8081/login";
  return requestBase(req) + "/login";
}

function verifyState(state: string | undefined, req?: any): { returnUrl: string; userId?: string } {
  const fallback = fallbackReturnUrl(req);
  if (!state) return { returnUrl: fallback };
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { returnUrl?: string; userId?: string };
    return { returnUrl: payload.returnUrl && safeReturnUrl(payload.returnUrl, req) ? payload.returnUrl : fallback, userId: payload.userId };
  } catch {
    return { returnUrl: fallback };
  }
}

export function encrypt(value: string) {
  const keyHex = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value: string) {
  const keyHex = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  const [ivText, tagText, dataText] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function getGoogleAccessToken(userId: string) {
  const connection = await prisma.googleConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("ยังไม่ได้เชื่อม Google Classroom");
  if (connection.expiresAt && connection.expiresAt.getTime() > Date.now() + 60_000) return decrypt(connection.accessTokenEncrypted);
  const refreshToken = decrypt(connection.refreshTokenEncrypted);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google connection ไม่สมบูรณ์ กรุณาเชื่อมต่อใหม่");
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const body: any = await response.json();
  if (!response.ok || !body.access_token) throw new Error("Google token refresh failed");
  await prisma.googleConnection.update({ where: { userId }, data: {
    accessTokenEncrypted: encrypt(String(body.access_token)),
    expiresAt: body.expires_in ? new Date(Date.now() + Number(body.expires_in) * 1000) : connection.expiresAt,
  }});
  return String(body.access_token);
}

function makeAppToken(user: { id: string; role: string }) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: "7d" });
}

router.post("/google/url", requireAuth(), (req: any, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Google OAuth ยังไม่ได้ตั้งค่า" });
    const requestedReturn = typeof req.body?.returnUrl === "string" ? req.body.returnUrl : "";
    const returnUrl = requestedReturn && safeReturnUrl(requestedReturn, req) ? requestedReturn : fallbackReturnUrl(req);
    const state = jwt.sign({ returnUrl, userId: req.user.id, nonce: crypto.randomBytes(16).toString("hex") }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(req), response_type: "code", scope: GOOGLE_SCOPES.join(" "), state, access_type: "offline", include_granted_scopes: "true", prompt: "consent" });
    res.json({ url: GOOGLE_AUTH + "?" + params.toString() });
  } catch (error) { res.status(500).json({ error: String(error instanceof Error ? error.message : error) }); }
});

router.get("/google/ready", async (req, res) => {
  try {
    // refresh=1 → ข้ามแคช 5 นาที (ใช้หลังผู้ใช้เพิ่งบันทึก Redirect URI ใน Google Console)
    const force = String(req.query.refresh || "") === "1";
    res.json({ ready: await googleRedirectReady(req, force) });
  } catch {
    res.json({ ready: false });
  }
});

router.get("/google/start", (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).send("Google OAuth ยังไม่ได้ตั้งค่า");
    const requestedReturn = typeof req.query.returnUrl === "string" ? req.query.returnUrl : "";
    const returnUrl = requestedReturn && safeReturnUrl(requestedReturn, req) ? requestedReturn : fallbackReturnUrl(req);
    const state = jwt.sign({ returnUrl, nonce: crypto.randomBytes(16).toString("hex") }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(req),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      state,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
    });
    res.redirect(GOOGLE_AUTH + "?" + params.toString());
  } catch (error) {
    res.status(500).send(String(error instanceof Error ? error.message : error));
  }
});

router.get("/google/callback", async (req, res) => {
  const oauthState = verifyState(typeof req.query.state === "string" ? req.query.state : undefined, req);
  const returnUrl = oauthState.returnUrl;
  const fail = (message: string) => res.redirect(returnUrl + (returnUrl.includes("?") ? "&" : "?") + "error=" + encodeURIComponent(message));

  try {
    if (typeof req.query.error === "string") return fail(req.query.error);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return fail("Google ไม่ได้ส่ง authorization code");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail("เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Google OAuth");

    const tokenResponse = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    const tokens: any = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) {
      // Log Google's error code (never log the authorization code or client secret).
      console.error("Google token exchange failed", tokens?.error, tokens?.error_description);
      const reason = String(tokens?.error || "unknown_error");
      return fail("แลกสิทธิ์ Google ไม่สำเร็จ (" + reason + ")");
    }

    const userResponse = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    const profile: any = await userResponse.json();
    if (!userResponse.ok || !profile.email) return fail("อ่านบัญชี Google ไม่สำเร็จ");

    const email = String(profile.email).trim().toLowerCase();
    const name = String(profile.name || profile.email.split("@")[0]).trim().slice(0, 80);
    // If the user initiated linking from an authenticated StudyPath session, attach Google to that account.
    let user = oauthState.userId ? await prisma.user.findUnique({ where: { id: oauthState.userId } }) : await prisma.user.findUnique({ where: { email } });
    if (oauthState.userId && !user) return fail("บัญชี StudyPath ที่เริ่มเชื่อมต่อไม่พบ กรุณาเข้าสู่ระบบใหม่");
    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      user = await prisma.user.create({ data: { name, email, passwordHash, role: "MEMBER", avatarUrl: profile.picture || null } });
    } else if (!user.avatarUrl && profile.picture) {
      user = await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: profile.picture } });
    }

    const refreshToken = String(tokens.refresh_token || "");
    const existing = await prisma.googleConnection.findUnique({ where: { userId: user.id } });
    if (!refreshToken && !existing) return fail("Google ไม่ได้ส่ง refresh token กรุณาอนุญาตการเข้าถึงอีกครั้ง");
    await prisma.googleConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        accessTokenEncrypted: encrypt(String(tokens.access_token)),
        refreshTokenEncrypted: encrypt(refreshToken),
        expiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null,
        scope: String(tokens.scope || GOOGLE_SCOPES.join(" ")),
      },
      update: {
        accessTokenEncrypted: encrypt(String(tokens.access_token)),
        ...(refreshToken ? { refreshTokenEncrypted: encrypt(refreshToken) } : {}),
        expiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : undefined,
        scope: String(tokens.scope || GOOGLE_SCOPES.join(" ")),
      },
    });

    const token = makeAppToken(user);
    res.redirect(returnUrl + (returnUrl.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token));
    // Classroom scopes were granted in this OAuth flow. Start the first import now;
    // the redirect is already sent, so large course files do not hold up login.
    void runAutosyncForUser(user.id, user.role).catch(() => undefined);
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return fail("เชื่อมต่อ Google ไม่สำเร็จ");
  }
});

export default router;
