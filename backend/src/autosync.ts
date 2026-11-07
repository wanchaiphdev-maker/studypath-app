import jwt from "jsonwebtoken";
import { prisma } from "./auth";

/**
 * ซิงก์ Google Classroom อัตโนมัติ
 * Google Classroom ไม่มี webhook จึงต้องดึงเป็นระยะ
 * ตัวกรองข้อความรบกวน (ขอลา / สมัครเรียน / หากลุ่ม) อยู่ใน routes/classroom.ts แล้ว
 */

const INTERVAL_MIN = Number(process.env.AUTOSYNC_MINUTES || 5);
const PORT = process.env.PORT || 3000;

let running = false;
let lastResult: Record<string, any> = {};

export function getAutosyncState() {
  return { running, lastResult, intervalMinutes: INTERVAL_MIN };
}

async function syncOneUser(userId: string, role: string) {
  const token = jwt.sign({ id: userId, role }, process.env.JWT_SECRET!, { expiresIn: "2h" });
  // ซิงก์เยอะ (ไฟล์ + งานที่นักเรียนส่ง) อาจใช้เวลาหลายนาที ต้องตั้ง timeout ให้ยาวกว่าค่า��ชิดของ undici (5 นาที)
  const res = await fetch(`http://localhost:${PORT}/studypath/classroom/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const body: any = await res.json().catch(() => ({}));
  // 409 = มีซิงก์อื่นกำลังทำงานอยู่ (ผู้ใช้กดซิงก์เอง) -> ไม่ใช่ข้อผิดพลาด
  if (res.status === 409) return { ...body, skippedBecauseBusy: true };
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export async function runAutosyncOnce(reason: string) {
  if (running) return { skipped: true as const, reason: "sync กำลังทำงานอยู่" };
  running = true;
  const startedAt = new Date();
  try {
    const connections = await prisma.googleConnection.findMany({
      select: { userId: true, user: { select: { email: true, role: true } } },
    });
    const results: any[] = [];
    for (const c of connections) {
      const key = c.user.email;
      try {
        const summary = await syncOneUser(c.userId, c.user.role);
        if (summary.skippedBecauseBusy) {
          console.log(`[autosync:${reason}] ${key}: ข้ามรอบนี้ (มีการซิงก์ด้วยมือกำลังทำงาน)`);
          results.push({ email: key, skipped: true });
          continue;
        }
        results.push({
          email: key,
          imported: summary.imported,
          updated: summary.updated,
          skipped: summary.skipped,
          failed: summary.failed,
          submissionsImported: summary.submissionsImported || 0,
          submissionsUpdated: summary.submissionsUpdated || 0,
        });
        const changed = (summary.imported || 0) + (summary.updated || 0);
        console.log(`[autosync:${reason}] ${key}: นำเข้าใหม่ ${summary.imported} · อัปเดต ${summary.updated}${changed ? "  <-- มีของใหม่" : ""} · งานที่ส่ง ${summary.submissionsImported || 0}/${summary.submissionsUpdated || 0}`);
      } catch (error) {
        results.push({ email: key, error: String(error instanceof Error ? error.message : error) });
        console.warn(`[autosync:${reason}] ${key}: ล้มเหลว -`, error);
      }
    }
    lastResult = { at: startedAt.toISOString(), reason, results };
    return { skipped: false as const, at: startedAt.toISOString(), results };
  } catch (error) {
    console.warn(`[autosync:${reason}] ล้มเหลวรวม -`, error);
    return { skipped: false as const, error: String(error) };
  } finally {
    running = false;
  }
}

export function startAutosync() {
  const ms = Math.max(1, INTERVAL_MIN) * 60_000;
  console.log(`[autosync] เริ่มทำงานอัตโนมัติทุก ${INTERVAL_MIN} นาที`);
  // รอ 30 วินาทีแรก เพื่อให้เซิร์ฟเวอร์เริ่มทำงานเสร็จก่อน
  setTimeout(() => {
    void runAutosyncOnce("startup");
    setInterval(() => void runAutosyncOnce("interval"), ms);
  }, 30_000);
  return () => void runAutosyncOnce("manual");
}
