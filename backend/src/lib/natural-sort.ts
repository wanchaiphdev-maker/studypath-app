/**
 * เรียงตามลำดับของมนุษย์อ่าน ไม่ใช่เรียงตามวันที่ที่ซิงก์เข้ามา
 *
 * ทำไมต้องมี: ตอนซิงก์จาก Classroom ลำดับไฟล์มาตามที่ API คืนมา (สุ่ม)
 * ทำให้ "Chapter 8" โผล่ก่อน "Chapter 1" และ "WEEK#14" ก่อน "WEEK#2"
 *
 * ใช้ Intl.Collator ตัวเลขอัตโนมัติ รองรับไทย/อังกฤษผสม
 */

const collator = new Intl.Collator("th", { numeric: true, sensitivity: "base" });

/** เลขแรกที่เจอในชื่อ ใช้เป็นตัวช่วยจัดลำดับ */
export function firstNumber(title: string) {
  const m = String(title || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * เรียงตามธรรมชาติ — ตัวเลขที่ฝังอยู่ในคำถูกเทียบเป็นตัวเลข ไม่ใช่ตัวอักษร
 *   "Chapter 2" < "Chapter 10"      (ไม่ใช่ 1, 10, 11, 2)
 *   "WEEK#2"   < "WEEK#14"
 *   "บทที่ 1"   < "บทที่ 10"
 *
 * ไม่พยายามจัด "กลุ่ม" เพราะการตัดเลขออกจากชื่อทำให้กลุ่มแตก
 * (เช่น "Chapter 8 -9" กับ "Chapter 1" กลายเป็นคนละกลุ่ม ผลคือเรียงกลับด้าน)
 */
export function naturalCompare(a: string, b: string) {
  return collator.compare(String(a || ""), String(b || ""));
}

export function sortByTitle<T extends { title?: string | null; fileName?: string | null; createdAt?: Date | string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ka = String(a.title || a.fileName || "");
    const kb = String(b.title || b.fileName || "");
    const c = naturalCompare(ka, kb);
    if (c !== 0) return c;
    // ชื่อซ้ำกัน (เช่น "Copy of Chapter 4" กับ "Chapter 4") → เก่าก่อน
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
}