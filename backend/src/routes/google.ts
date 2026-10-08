import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../auth";

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
  "https://www.googleapis.com/auth/drive.readonly",
];

function redirectUri() {
  const base = process.env.PUBLIC_BASE_URL?.trim() || `http://localhost:${process.env.PORT || 3000}`;
  return base.replace(/\/$/, "") + "/auth/google/callback";
}

function safeReturnUrl(value: string) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && ["localhost", "127.0.0.1"].includes(u.hostname)
      || ["exp:", "mobile:", "studypath:"].includes(u.protocol);
  } catch {
    return false;
  }
}

function verifyStateReturn(state: string | undefined) {
  const fallback = process.env.EXPO_PUBLIC_APP_RETURN_URL || "http://localhost:8081/login";
  if (!state) return fallback;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { returnUrl?: string };
    return payload.returnUrl && safeReturnUrl(payload.returnUrl) ? payload.returnUrl : fallback;
  } catch {
    return fallback;
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

router.get("/google/start", (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).send("Google OAuth ยังไม่ได้ตั้งค่า");
    const requestedReturn = typeof req.query.returnUrl === "string" ? req.query.returnUrl : "";
    const returnUrl = requestedReturn && safeReturnUrl(requestedReturn) ? requestedReturn : (process.env.EXPO_PUBLIC_APP_RETURN_URL || "http://localhost:8081/login");
    const state = jwt.sign({ returnUrl, nonce: crypto.randomBytes(16).toString("hex") }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
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
  const returnUrl = verifyStateReturn(typeof req.query.state === "string" ? req.query.state : undefined);
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
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const tokens: any = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Google token exchange failed", tokens?.error);
      return fail("แลกสิทธิ์ Google ไม่สำเร็จ");
    }

    const userResponse = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    const profile: any = await userResponse.json();
    if (!userResponse.ok || !profile.email) return fail("อ่านบัญชี Google ไม่สำเร็จ");

    const email = String(profile.email).trim().toLowerCase();
    const name = String(profile.name || profile.email.split("@")[0]).trim().slice(0, 80);
    let user = await prisma.user.findUnique({ where: { email } });
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
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return fail("เชื่อมต่อ Google ไม่สำเร็จ");
  }
});

export default router;
