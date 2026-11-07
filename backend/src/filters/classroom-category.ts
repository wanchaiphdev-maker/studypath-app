/**
 * จัดหมวดเนื้อหาจาก Google Classroom — เก็บเฉพาะที่ผู้ใช้ต้องการ
 *
 * ที่ผู้ใช้ขอไว้:
 *   โบนัส · งานในห้อง · การบ้าน · เช็คชื่อ · VDO · สไลด์
 *   "อย่างอื่นไม่ต้องเอาเข้ามา"
 *   "การบ้านงานในห้องให้เก็บโจทย์ที่ทำไว้เอาไปทำในโหมดข้อสอบ"
 *
 * จุดสำคัญ: อย่าเดาจากชื่ออย่างเดียว เพราะสไลด์ในบางวิชาชื่อ "Set" หรือ "CH04 Shortest Path"
 *          ซึ่งไม่มีคำว่า slide/chapter เลย
 *          ต้องดู "ประเภทรายการใน Classroom" ด้วย ซึ่งถูกเข้ารหัสไว้ใน externalId แล้ว
 *          รูปแบบ: classroom:<courseId>:<courseWork|courseWorkMaterials|announcements>:<itemId>:<suffix>
 */

import { ADMIN_NAME_RE, CASUAL_CHATTER_RE, CHATTER_FIRST_RE } from "./classroom-filters";

export type ClassroomItemKind = "courseWork" | "courseWorkMaterials" | "announcements" | "local" | "unknown";

export type ContentCategory =
  | "bonus"        // โบนัส
  | "inclass"      // งานในห้อง
  | "homework"     // การบ้าน
  | "checkin"      // เช็คชื่อ
  | "vdo"          // วิดีโอ / คลิป
  | "slide"        // สไลด์ / เอกสารประกอบการเรียน
  | null;          // ไม่เข้าหมวดที่ต้องการ = ไม่เอา

/** แกะประเภทรายการออกจาก externalId ที่ตั้งตอนซิงก์ */
export function itemKindOf(externalId: string | null | undefined): ClassroomItemKind {
  const parts = String(externalId || "").split(":");
  if (parts[0] !== "classroom") return "local";
  const kind = parts[2];
  if (kind === "courseWork" || kind === "courseWorkMaterials" || kind === "announcements") return kind;
  return "unknown";
}

/* ---------------- กฎแยกหมวดจากชื่อ ---------------- */

const RE_BONUS = /โบนัส|\bbônus\b/i;

const RE_INCLASS = /(งาน|คำถาม|โจทย์|แบบฝึกหัด|ทำข้อ)[^|]{0,18}ในห้อง|ในห้อง|ห้องเรียน/i;

const RE_HOMEWORK = new RegExp([
  "การบ้าน", "ส่งการบ้าน", "ส่งงาน", "ส่งชิ้นงาน", "^บ้าน", "บ้าน$",
  "ใบงาน", "แบบฝึกหัด", "แบบฝึกหัดที่", "ทำข้อ", "ทำแบบฝึกหัด",
  "^WEEK\\s*#?\\s*\\d+", "^WEEK#", "assignment", "homework", "lab\\s*\\d",
  "แนวการบ้าน", "คำสั่งเรียน", "ส่งงาน",
].join("|"), "i");

const RE_CHECKIN = new RegExp([
  "เช็คชื่อ", "เช็กชื่อ", "ตรวจชื่อ", "ลงชื่อ(เข้า|เข้าเรียน|รับ|นิสิต)",
  "sign\\s*-?\\s*in", "check\\s*-?\\s*in", "roll\\s*-?\\s*call", "เช็คคะแนน", "เข้าเรียน",
].join("|"), "i");

const RE_VDO = /\bvdo\b|วีดีโอ|วิดีโอ|video|\bคลิป\b|คลิปวิดีโอ|yt\b|youtube/i;

const RE_SLIDE = /slide|สไลด์|chapter|บทที่|^บท|lecture|มคอ|syllabus|เอกสารประกอบ|เอกสารประกอบการเรียน|เอกสารประกอบการสอน|รวมเล่ม|เอกสารประกอบรายวิชา/i;

/** ขยะที่อาจหลุดเข้ามาในหมวด courseWorkMaterials (อาจารย์แปะลิงก์ไว้ในหมวดสไลด์) */
const RE_MATERIAL_JUNK = new RegExp([
  "e-?mail\\s*(address)?\\s*ของ", "@o365", "เตรียม\\s*e?\\s*-?\\s*mail",
  "ช่องทางการติดต่อ", "ติดต่อ(กลับ|อาจารย์|เข้า)",
  "ประกาศ", "หลักฐาน(การ)?ร่วม", "ขอเชิญ", "เข้าร่วม(กิจกรรม|โครงการ|แข่งขัน)",
  "การประกวด|ประกวด|hackathon", "thai\\s*ai\\s*passport", "ลงทะเบียน",
  "รับรางวัล", "กิจกรรม(กีฬา|เสริม)", "รายชื่อ(สมาชิก|นักศึกษา|กลุ่ม)",
  "คะแนน(ไม่|จะ|วัด)", "โบนัส(รางวัล|พิเศษ|ประจำ|กิจกรรม|จาก)",
  "facebook\\s+messenger", "community\\s*chat", "สอบ(กลาง|ย่อย|ปลาย)ภาค", "สอบถาม",
].join("|"), "i");

/**
 * สิ่งที่อยู่ในหมวด "งานที่มอบหมาย" แต่ไม่ใช่การบ้าน/งานในห้องที่ต้องเก็บ
 * เช่น ข้อสอบ, โปรเจกต์, รางวัล, หลักฐานการเข้าร่วม, ช่องทางติดต่อ
 */
const RE_NON_ASSIGNMENT = new RegExp([
  "^quiz", "\\bquiz\\b", "ควิซ|ข้อสอบ|สอบ(กลาง|ย่อย|ปลาย)ภาค|แบบทดสอบ",
  "ทดสอบก่อน(เรียน|สอบ)", "จำนวนข้อสอบ",
  "\\bmini\\s*project\\b|\\bproject\\b|โปรเจกต์|โปรเจค",
  "รับรางวัล|รางวัล", "หลักฐาน(การ)?ร่วม", "กิจกรรม(กีฬา|เสริม)",
  "ช่องทางการติดต่อ|ติดต่อ(กลับ|อาจารย์|เข้า)",
  "e-?mail\\s*(address)?\\s*ของ|@o365|เตรียม\\s*e?\\s*-?\\s*mail",
  "thai\\s*ai\\s*passport|ลงทะเบียน|ประกาศ|ใบสำคัญ|เช็กคะแนน|เช็คคะแนน",
  "thinking\\s*reflection|reflection",
].join("|"), "i");

/** งานที่มอบหมายที่ถูกโพสต์ผิดหมวดมาเป็นประกาศ (ต้องเก็บ) */
const RE_ASSIGNMENT_IN_ANNOUNCEMENT = new RegExp([
  "ให้ทำรายงาน", "ให้นิสิตทำงาน", "ทำงานส่ง", "ส่งงาน(ใน|ก่อน|ภายใน)",
  "ให้ส่งงาน", "ส่งการบ้าน", "ใบสั่งงาน", "ทำแบบฝึกหัด",
  "\\d+\\s*คะแนน", "คะแนน\\s*\\d+",
].join("|"), "i");

/**
 * ลิงก์/ประกาศเข้าเรียนออนไลน์ — ขยะ แต่ต้องแยกออกจาก "ไฟล์บรรยายที่สอนออนไลน์"
 * เช่น "Link Online 14-08-69-21.00 น." = ลิงก์เข้าเรียน (ขยะ)
 *      "เอกสารประกอบการเรียน-Online-30-07-69" = สไลด์บรรยาย (เนื้อหา)
 */
const RE_ONLINE_SESSION = new RegExp([
  "^link\\s*online", "online\\s*(link|record|recording|class)", "^online\\s*[-–—:]\\s*\\d",
  "เรียน\\s*(ออนไลน์|ออนไซต์|online)", "^online\\b", "คืนนี้", "พบกัน", "เวลา\\s*\\d+\\s*\\.",
].join("|"), "i");

/** ร่องรอยว่าเป็นไฟล์เนื้อหาจริง แม้ชื่อมีคำว่า "ออนไลน์" */
const RE_LECTURE_FILE = new RegExp([
  "เอกสารประกอบ", "^บทที่", "^บท", "chapter", "lecture", "slide",
  "^week", "มคอ", "syllabus", "เอกสารประกอบการสอน",
].join("|"), "i");

function looksLikeChatter(text: string) {
  return ADMIN_NAME_RE.test(text) || CASUAL_CHATTER_RE.test(text) || CHATTER_FIRST_RE.test(text);
}

/**
 * จัดหมวดหนึ่งรายการ
 * @param externalId รหัสภายนอกที่มีประเภท Classroom ฝังไว้
 * @param title ชื่อที่แสดง
 * @param mimeType ชนิดไฟล์ (ช่วยแยกวิดีโอที่ชื่อไม่บอก)
 */
/** ไฟล์จริง (PDF / PPT / DOCX / รูป / วิดีโอ) — ต่างจากข้อความล้วนหรือลิงก์ */
export function isRealFile(mimeType: string | null | undefined): boolean {
  const m = String(mimeType || "").toLowerCase();
  if (!m) return false;
  if (/^(video|audio|image)\//.test(m)) return true;
  if (/^(application|text\/csv|text\/html)/.test(m)) return true;
  return false;
}

export function categorize(
  externalId: string | null | undefined,
  title: string | null | undefined,
  mimeType?: string | null,
): ContentCategory {
  const kind = itemKindOf(externalId);
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const isVideo = /^(video|audio)\//.test(String(mimeType || ""));
  const hasFile = isRealFile(mimeType);

  // 1) ประกาศ
  //    - ที่มี "ไฟล์แนบจริง" = อาจารย์โพสต์สไลด์/วิดีโอ ผ่านหน้าประกาศ -> เก็บ
  //      เช่น "ส่วนอันนี้เเนวข้อสอบกลางภาคนะคะทุกคน" ที่แนบไฟล์ PowerPoint
  //      และ "เนื้อหาบทที่ 6 นะคะ" ที่แนบวิดีโอ
  //    - ที่เป็นข้อความล้วน = แชท/ธุระ -> ไม่เอา
  //    - เว้นแต่เป็นคำสั่งงานที่มอบหมาย -> เก็บเป็นการบ้าน
  if (kind === "announcements") {
    if (isVideo || RE_VDO.test(t)) return "vdo";
    if (hasFile && !RE_MATERIAL_JUNK.test(t) && !looksLikeChatter(t)) return "slide";
    if (RE_ASSIGNMENT_IN_ANNOUNCEMENT.test(t) && !RE_NON_ASSIGNMENT.test(t)) return "homework";
    return null;
  }

  // 2) วิดีโอ — ชนิดไฟล์บอกได้แม่ชื่อไม่บอก (เช่น "วีดีโอลำดับและอนุกรม")
  if (isVideo || RE_VDO.test(t)) return "vdo";

  // 3) สไลด์/เอกสารประกอบ = หมวด materials ของ Classroom
  //    แต่ต้องตัดขยะที่อาจารย์แปะทิ้งไว้ในหมวดนี้
  if (kind === "courseWorkMaterials") {
    if (!t) return null;
    if (RE_MATERIAL_JUNK.test(t) || looksLikeChatter(t)) return null;
    // "เอกสารประกอบการเรียน-Online-30-07-69" คือไฟล์บรรยายในห้องที่สอนออนไลน์
    // ไม่ใช่ลิงก์เข้าเรียน จึงต้องไม่ตัดทิ้ง
    if (RE_ONLINE_SESSION.test(t) && !RE_LECTURE_FILE.test(t)) return null;
    return "slide";
  }

  // 4) งานที่มอบหมาย = หมวด courseWork
  //    ตามนิยามของ Classroom ทุกอย่างในหมวดนี้คืองานที่ให้นักศึกษาทำ
  //    จึงเริ่มต้นเป็น "การบ้าน" แล้วค่อยตัดของที่ไม่ใช่การเรียนออก
  if (kind === "courseWork") {
    if (RE_CHECKIN.test(t)) return "checkin";
    if (RE_BONUS.test(t)) return "bonus";
    // ของที่ไม่ใช่การเรียน: ข้อสอบ / โปรเจกต์ / รางวัล / หลักฐาน / ช่องทางติดต่อ
    if (RE_NON_ASSIGNMENT.test(t)) return null;
    if (RE_INCLASS.test(t)) return "inclass";
    if (RE_HOMEWORK.test(t)) return "homework";
    if (RE_SLIDE.test(t)) return "slide";
    // เช่น "Boolean Logic", "อนุกรมเลขคณิต", "หา Euler path", "งานกลุ่ม FA"
    // คืองานที่อาจารย์ตั้งเป็นการบ้านแต่ชื่อไม่ได้เขียนว่า "การบ้าน"
    if (looksLikeChatter(t)) return null;
    return "homework";
  }

  // 5) ข้อมูลที่สร้างในแอปเอง (อัปโหลด/อัดเสียง/เขียนโน้ต) = เก็บเสมอ
  if (kind === "local") return "slide";

  // 6) ไม่รู้ประเภท — ตัดไว้ก่อน ดีกว่าปล่อยผ่านขยะ
  return null;
}

/** หมวดที่เก็บ "โจทย์ที่นักศึกษาทำไว้" ไปใช้สร้างข้อสอบ */
export const ASSIGNMENT_CATEGORIES: ContentCategory[] = ["homework", "inclass", "bonus"];

/** ป้ายแสดงผลภาษาไทย */
export const CATEGORY_LABEL: Record<string, string> = {
  bonus: "โบนัส",
  inclass: "งานในห้อง",
  homework: "การบ้าน",
  checkin: "เช็คชื่อ",
  vdo: "VDO",
  slide: "สไลด์",
};

/** สรุปจำนวนรายการแยกตามหมวด (ใช้รายงาน/ดีบัก) */
export function categorySummary(
  rows: { externalId: string | null; title: string | null; mimeType?: string | null }[],
) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const c = categorize(r.externalId, r.title, r.mimeType) || "drop";
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}