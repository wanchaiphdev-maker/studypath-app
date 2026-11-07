/**
 * ocr-run.ts — แปลง PDF รูปภาพล้วนเป็นข้อความด้วย tesseract.js (รันบนเครื่อง ไม่ส่งไฟล์ออกนอกเครื่อง)
 *
 * ปัญหา: PDF บางบท (วิชา 1204102) เป็นรูปสแกนล้วน pdf-parse ดึงได้แค่เครื่องหมายหน้า
 *         "-- N of M --" ทำให้ AI ไม่มีเนื้อหาใช้สร้างโจทย์/ตอบคำถาม
 *
 * วิธี:  ทุกหน้า แยกเป็น 2 ทาง
 *   - หน้าที่มีข้อความอยู่แล้ว (≥40 ตัวอักษร) → ใช้ข้อความเดิม (คุณภาพดีกว่า OCR)
 *   - หน้าว่าง/บางมาก → render เป็น PNG (pdf-to-img) แล้ว OCR ด้วย tesseract (tha+eng)
 *   ผลรวมเรียงตามหน้าพร้อมเครื่องหมาย "-- N of M --" แบบเดิม แล้วเขียนทับ textContent + rebuild chunks
 *
 * สำรอง textContent เก่าทุกไฟล์ไว้ tools/_ocr-backup-<ts>.json ก่อนเขียนทับ
 *
 * ใช้:  node node_modules\ts-node\dist\bin.js tools\ocr-run.ts [filterชื่อไฟล์] [maxPages]
 *   เช่น node node_modules\ts-node\dist\bin.js tools\ocr-run.ts "Chapter 6" 3
 */
import { prisma } from "../src/auth";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";

// ESM-only โหลดผ่าน require (Node ≥22.12 รองรับ require(ESM)) — ตรงกันทั้ง runtime และ typecheck
const { pdf } = require("pdf-to-img");

/**
 * แยกข้อความรายหน้าจาก textContent เดิม (ที่มีเครื่องหมาย "-- N of M --" อยู่แล้ว)
 * — ไม่โหลด pdfjs ซ้ำ เพราะ node_modules มี 2 เวอร์ชัน (v6 ของโปรเจกต์ vs v5 ของ pdf-to-img)
 *    ทำให้ API/Worker version ไม่ตรงกัน
 */
function parseStoredPages(stored: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /--\s*(\d+)\s+of\s+\d+\s*--/g;
  const marks: { n: number; start: number }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(stored))) marks.push({ n: Number(mm[1]), start: mm.index + mm[0].length });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : stored.length;
    out.set(marks[i].n, stored.slice(marks[i].start, end).trim());
  }
  return out;
}

/** copy จาก routes/classroom.ts chunkText (ไม่ export กัน) */
function chunkText(text: string) {
  const parts = text.split(/(?<=[.!?。！？])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if ((current + " " + part).trim().length > 1200 && current) {
      chunks.push(current.trim());
      current = part;
    } else current = (current + " " + part).trim();
  }
  if (current) chunks.push(current);
  return chunks;
}

/** หน้าที่มีข้อความจริงน้อยกว่านี้ = ภาพล้วน ต้อง OCR */
const MIN_PAGE_CHARS = 40;

function stripMarkers(t: string): string {
  return t.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "").replace(/\s+/g, " ").trim();
}

(async () => {
  const filter = process.argv[2] || "";
  const maxPages = Number(process.argv[3] || 0);

  const sub = await prisma.subject.findFirst({ where: { name: { contains: "1204102" } } });
  if (!sub) { console.log("ไม่พบวิชา 1204102"); await prisma.$disconnect(); return; }

  // เป้าหมาย: PDF ที่ชื่อมี Chapter (ยกเว้น Chapter 1 ที่มีข้อความดีอยู่แล้ว และ รวมเล่ม ที่มีข้อความครบ)
  const mats = await prisma.material.findMany({
    where: { subjectId: sub.id, mimeType: "application/pdf" },
    select: { id: true, fileName: true, filePath: true, textContent: true, pageCount: true },
    orderBy: { fileName: "asc" },
  });
  const list = mats.filter((m) => {
    const n = String(m.fileName || "");
    return /chapter/i.test(n) && !/chapter\s*1[\s.]/i.test(n) && !n.includes("รวมเล่ม");
  });

  const picked = list.filter((m) => !filter || String(m.fileName).includes(filter));
  console.log(`เป้าหมาย ${picked.length} ไฟล์ (filter="${filter}" maxPages=${maxPages || "ไม่จำกัด"})`);
  for (const m of picked) console.log("  - " + m.fileName);

  const backupPath = path.join(__dirname, `_ocr-backup-${Date.now()}.json`);
  const backup: any[] = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, "utf8")) : [];

  const worker = await createWorker(["tha", "eng"]);
  console.log("[ocr] tesseract worker พร้อม (tha+eng) — ดาวน์โหลดตารางภาษาครั้งแรกอาจใช้เวลา");

  for (const m of picked) {
    if (!m.filePath || !fs.existsSync(m.filePath)) { console.log(`[skip] ${m.fileName} — ไม่พบไฟล์บนดิสก์`); continue; }
    const t0 = Date.now();
    try {
      console.log(`\n=== ${m.fileName} ===`);
      const storedPages = parseStoredPages(m.textContent || "");
      const doc = await pdf(m.filePath, { scale: 3, format: "png" });
      const N = Math.min(doc.length, maxPages || Infinity);
      const finalPages: string[] = [];
      let ocrCount = 0;

      let idx = 0;
      for await (const img of doc) {
        idx++;
        if (idx > N) break;
        const pageStored = storedPages.get(idx) || "";
        const existing = stripMarkers(pageStored);
        if (existing.length >= MIN_PAGE_CHARS) {
          finalPages.push(pageStored);
          process.stdout.write(`p${idx}มีข้อความเดิม(` + existing.length + ") ");
        } else {
          const s = Date.now();
          const { data } = await worker.recognize(img);
          const text = String(data.text || "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
          finalPages.push(text);
          ocrCount++;
          process.stdout.write(`p${idx}OCR(${((Date.now() - s) / 1000).toFixed(1)}s,${text.length}ตัว) `);
        }
        if (idx % 10 === 0) process.stdout.write("\n");
      }
      await doc.destroy();

      const finalText = finalPages.map((t, i) => `-- ${i + 1} of ${finalPages.length} --\n\n${t}`).join("\n\n");
      const newContent = stripMarkers(finalText).length;
      const oldContent = stripMarkers(m.textContent || "").length;
      console.log(`\n[ผล] ${m.fileName}: หน้า OCR ${ocrCount}/${finalPages.length} · เดิม ${oldContent} ตัว → ใหม่ ${newContent} ตัว · ใช้เวลา ${((Date.now() - t0) / 1000).toFixed(0)}s`);

      const partial = finalPages.length < doc.length; // รันแบบจำกัดหน้า (smoke test) = ห้ามเขียนฐาน
      if (partial) {
        console.log(`[ข้าม] ${m.fileName} — รันจำกัดหน้า (smoke) ไม่เขียนฐาน (${finalPages.length}/${doc.length} หน้า)`);
      } else if (newContent > oldContent) {
        backup.push({ id: m.id, fileName: m.fileName, oldText: m.textContent });
        fs.writeFileSync(backupPath, JSON.stringify(backup), "utf8");
        await prisma.material.update({
          where: { id: m.id },
          data: {
            textContent: finalText,
            pageCount: finalPages.length,
            chunks: { deleteMany: {}, create: chunkText(finalText).map((content, chunkIndex) => ({ content, chunkIndex })) },
          },
        });
        console.log(`[อัปเดต] ${m.fileName} → textContent + chunks ใหม่ (สำรองแล้วที่ ${path.basename(backupPath)})`);
      } else {
        console.log(`[ข้าม] ${m.fileName} — ผลใหม่ไม่ดีกว่าเดิม`);
      }
    } catch (e: any) {
      console.error(`[ผิดพลาด] ${m.fileName}: ${String(e?.message || e).slice(0, 300)}`);
    }
  }

  await worker.terminate();
  await prisma.$disconnect();
  console.log("\nเสร็จสิ้น");
  process.exit(0);
})();
