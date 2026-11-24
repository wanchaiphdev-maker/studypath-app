import * as Linking from "expo-linking";
import { BASE_URL } from "./api";


/** Client ID สาธารณะ (ปลอดภัยที่จะอยู่ในแอป) เก็บในไฟล์ .env */
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/**
 * แสดง/ซ่อนปุ่ม "เข้าสู่ระบบด้วย Google"
 * - เวอร์ชันปกติ (เครื่องเรา/เดสก์ท็อป) แสดงไว้
 * - เวอร์ชันแชร์สาธารณะ build ด้วย EXPO_PUBLIC_GOOGLE_LOGIN=0 เพื่อไม่ให้เพื่อนเจอหน้า
 *   "Google hasn't verified this app / ไปที่ ... (unsafe)" และ dead-end ที่ localhost
 * เปิดกลับได้ทันทีเมื่อลงทะเบียน redirect URI ของโดเมนนั้นใน Google Cloud Console แล้ว
 */
export function isGoogleLoginEnabled() {
  return process.env.EXPO_PUBLIC_GOOGLE_LOGIN !== "0";
}

/** จุดที่ Google จะ redirect มาหลังผู้ใช้กดยินยอม — ชี้ไป backend ของเรา (แลก code ฝั่ง server) */

/** ที่อยู่ให้ backend ส่ง token กลับมาที่แอป (mobile:///login ตอนใช้ APK / exp://…/--/login ตอนใช้ Expo Go) */
export function appReturnUrl(path = "login") {
  // On web, return to the actual Expo Router route (for example /classroom),
  // not a native deep-link URL that the browser router may not recognize.
  if (typeof window !== "undefined") {
    return `${window.location.origin}/${path.replace(/^\/+/, "")}`;
  }
  return Linking.createURL(path);
}

/** สร้าง URL หน้า consent ของ Google */
export function buildGoogleAuthUrl(returnPath = "login") {
  if (!BASE_URL) throw new Error("ยังไม่ได้ตั้งค่า EXPO_PUBLIC_API_URL ในไฟล์ .env");
  return `${BASE_URL.replace(/\/$/, "")}/auth/google/start?returnUrl=${encodeURIComponent(appReturnUrl(returnPath))}`;
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
