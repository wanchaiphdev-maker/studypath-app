import * as Linking from "expo-linking";
import { BASE_URL } from "./api";

/** Client ID สาธารณะ (ปลอดภัยที่จะอยู่ในแอป) เก็บในไฟล์ .env */
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** จุดที่ Google จะ redirect มาหลังผู้ใช้กดยินยอม — ชี้ไป backend ของเรา (แลก code ฝั่ง server) */
const REDIRECT_URI = `${BASE_URL?.replace(/\/$/, "")}/auth/google/callback`;

/** ที่อยู่ให้ backend ส่ง token กลับมาที่แอป (mobile:///login ตอนใช้ APK / exp://…/--/login ตอนใช้ Expo Go) */
export function appReturnUrl() {
  return Linking.createURL("login");
}

/** สร้าง URL หน้า consent ของ Google */
export function buildGoogleAuthUrl() {
  if (!GOOGLE_CLIENT_ID) throw new Error("ยังไม่ได้ตั้งค่า EXPO_PUBLIC_GOOGLE_CLIENT_ID ในไฟล์ .env");
  const params: Array<[string, string]> = [
    ["client_id", GOOGLE_CLIENT_ID],
    ["redirect_uri", REDIRECT_URI],
    ["response_type", "code"],
    ["scope", "openid email profile"],
    ["state", appReturnUrl()],
    ["prompt", "select_account"],
  ];
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

/**
 * อ่าน token/ข้อผิดพลาดจาก deep link ที่ backend redirect กลับมา
 * เช่น mobile:///login?token=xxx หรือ exp://…/--/login?error=…
 */
export function parseAuthCallback(url?: string | null): { token: string | null; error: string | null } | null {
  if (!url) return null;
  const marker = url.indexOf("?");
  if (marker < 0) return null;
  const query = url.slice(marker + 1).split("#")[0];
  const token = new URLSearchParams(query).get("token");
  const error = new URLSearchParams(query).get("error");
  if (!token && !error) return null;
  return { token, error };
}
