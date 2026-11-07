/**
 * ล้าง "รายการที่ไม่ใช่เนื้อหาการเรียน" ที่เคยหลุดเข้ามา ก่อนกฎใหม่
 *
 * ใช้กฎชุดเดียวกับตอนซิงก์ (filters/classroom-filters.ts)
 *
 *   node tools/clean-notice-materials.ts --dry     ดูรายการที่จะลบ ไม่ลบจริง
 *   node tools/clean-notice-materials.ts --apply    ลบจริง (มี JSON backup ก่อนเสมอ)
 *
 * ปลอดภัย: จะไม่แตะรายการที่ผู้ใช้อัปโหลดเอง (ไม่มี externalId)
 * ปลอดภัย: จะไม่แตะรายการที่มีไฟล์จริงแนบมา
 * ปลอดภัย: คำว่า "ทดสอบ" ไม่อยู่ในเงื่อนไขใดเลย
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { classifyExistingMaterial, displayTitle, isGenericTitle, hasSubstantiveContent, contentQuality, ADMIN_NAME_RE, WORKSHEET_RE, CHATTER_FIRST_RE, CASUAL_CHATTER_RE } from "../src/filters/classroom-filters";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RENAME_ONLY = process.argv.includes("--rename-only");
const OUT = path.resolve(process.cwd(), "tools", "_clean-backup-" + Date.now() + ".json");

(async () => {
  const subs = await prisma.subject.findMany();
  const nameOf = new Map(subs.map((s: any) => [s.id, s.name]));
  const mats = await prisma.material.findMany({ orderBy: { createdAt: "asc" } });

  const junk: any[] = [];
  const keep: any[] = [];
  for (const m of mats) {
    let verdict = classifyExistingMaterial(m);
    // สไลด์รูปภาพ (ดึงข้อความไม่ได้) + ชื่อที่เป็นงานธุระจัดการ = ไม่ต้องเอามาใช้
    // ส่วน "สั้นแต่มีข้อความจริง" เก็บไว้ เพราะเป็นโครงเรียนของวิชา (เช่น "บทที่ 1 Boolean Logic")
    let note = "";
    const name = String(m.title || "") + " " + String(m.fileName || "");
    const isWorksheet = WORKSHEET_RE.test(name);
    if (verdict === "keep" && !hasSubstantiveContent(m)) {
      const q = contentQuality(m);
      if (CHATTER_FIRST_RE.test(name) || CASUAL_CHATTER_RE.test(name)) verdict = "chatter";
      else if (!isWorksheet && ADMIN_NAME_RE.test(name)) verdict = "admin-name";
      else if (!q.hasText) verdict = "thin-ratio";
      else note = "สั้น-ใช้เป็นหัวข้อได้แต่ทำโจทย์ไม่ได้";
    }
    const row = {
      id: m.id, subjectId: m.subjectId, subject: nameOf.get(m.subjectId),
      title: m.title, fileName: m.fileName, externalId: m.externalId,
      letters: contentQuality(m).letters, ratio: contentQuality(m).ratio, note,
      text: String(m.textContent || "").slice(0, 150).replace(/\s+/g, " "),
      verdict,
    };
    if (verdict === "keep") keep.push(row);
    else junk.push(row);
  }

  // ---------- รายการซ้ำ: ไฟล์เดียวกันโผล่หลายครั้งในวิชาเดียวกัน ----------
  // จับคู่ด้วย driveFileId ก่อน ถ้าไม่มีใช้ fileName + ความยาวข้อความ
  const seen = new Map<string, any>();
  const dupes: any[] = [];
  for (const m of mats) {
    if (!m.externalId) continue;                       // ไม่แตะของที่ผู้ใช้อัปโหลดเอง
    const key = m.driveFileId
      ? "d:" + m.driveFileId
      : m.fileName ? "f:" + m.subjectId + ":" + m.fileName + ":" + String(m.textContent || "").length : "";
    if (!key) continue;
    if (seen.has(key)) dupes.push({ ...m, _dupeOf: seen.get(key).id });
    else seen.set(key, m);
  }

  // ---------- ชื่อไฟล์ที่ไม่มีความหมาย ("เอกสาร", "แนว", "Material") ----------
  const junkIds = new Set(junk.map((j) => j.id));
  const rename: any[] = [];
  for (const m of mats) {
    if (junkIds.has(m.id)) continue;                // จะถูกลบอยู่แล้ว ไม่ต้องเปลี่ยนชื่อ
    if (!isGenericTitle(String(m.title || ""))) continue;
    const better = displayTitle(m.title, m.fileName || "");
    if (better === String(m.title || "").trim()) continue;
    rename.push({ id: m.id, from: m.title, to: better, subject: nameOf.get(m.subjectId) });
  }

  console.log("สรุป: ทั้งหมด " + mats.length
    + " | จะลบขยะ " + junk.length
    + " | จะลบซ้ำ " + dupes.length
    + " | จะเปลี่ยนชื่อ " + rename.length);
  console.log("");

  const byVerdict: Record<string, any[]> = {};
  for (const j of junk) (byVerdict[j.verdict] = byVerdict[j.verdict] || []).push(j);

  for (const [v, rows] of Object.entries(byVerdict)) {
    console.log("=== " + v + " (" + rows.length + " รายการ) ===");
    const bySub: Record<string, any[]> = {};
    for (const r of rows) (bySub[r.subject || "?"] = bySub[r.subject || "?"] || []).push(r);
    for (const [sn, rs] of Object.entries(bySub)) {
      console.log("  " + String(sn).slice(0, 44) + "  (" + rs.length + ")");
      for (const r of rs.slice(0, 12)) console.log("      - " + String(r.title).replace(/\s+/g, " ").slice(0, 68));
      if (rs.length > 12) console.log("      ... และอีก " + (rs.length - 12) + " รายการ");
    }
    console.log("");
  }

  if (rename.length) {
    console.log("=== ชื่อไม่มีความหมาย → ใช้ชื่อไฟล์จริง (" + rename.length + ") ===");
    const bySub: Record<string, any[]> = {};
    for (const r of rename) (bySub[r.subject || "?"] = bySub[r.subject || "?"] || []).push(r);
    for (const [sn, rs] of Object.entries(bySub)) {
      console.log("  " + String(sn).slice(0, 44));
      for (const r of rs.slice(0, 8)) console.log("      " + String(r.from).slice(0, 26) + "  ->  " + String(r.to).slice(0, 50));
      if (rs.length > 8) console.log("      ... +" + (rs.length - 8));
    }
    console.log("");
  }

  if (dupes.length) {
    console.log("=== รายการซ้ำ (" + dupes.length + ") ===");
    const bySub: Record<string, any[]> = {};
    for (const r of dupes) (bySub[r.subjectId] = bySub[r.subjectId] || []).push(r);
    for (const [sid, rs] of Object.entries(bySub)) {
      console.log("  " + String(nameOf.get(sid) || sid).slice(0, 44) + " (" + rs.length + ")");
      for (const r of rs.slice(0, 6)) console.log("      x" + rs.filter((x: any) => x.title === r.title).length + "  " + String(r.title).replace(/\s+/g, " ").slice(0, 54));
      if (rs.length > 6) console.log("      ... +" + (rs.length - 6));
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("[dry-run] ไม่ได้ลบอะไร — ใช้ --apply เพื่อลบจริง");
    await prisma.$disconnect();
    return;
  }

  // โหมด "คืนชื่อ" = เปลี่ยนชื่อที่ไม่มีความหมาย แต่ไม่ลบอะไรเลย
  // ใช้ตอนผู้ใช้ต้องการเห็นไฟล์ครบ แต่ยังอยากให้ชื่อบอกเนื้อหาจริง
  if (RENAME_ONLY) {
    for (const r of rename) {
      await prisma.material.update({ where: { id: r.id }, data: { title: r.to } });
    }
    console.log("[rename-only] เปลี่ยนชื่อ " + rename.length + " รายการ ไม่ได้ลบอะไร");
    await prisma.$disconnect();
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ junk, dupes: dupes.map((d: any) => ({ id: d.id, title: d.title, fileName: d.fileName, subjectId: d.subjectId })), rename }, null, 2), "utf8");
  console.log("สำรองข้อมูลไว้ที่: " + OUT);

  // 1) เปลี่ยนชื่อที่ไม่มีความหมาย
  if (rename.length) {
    for (const r of rename) {
      await prisma.material.update({ where: { id: r.id }, data: { title: r.to } });
    }
    console.log("  เปลี่ยนชื่อ " + rename.length + " รายการ");
  }

  // 2) ลบรายการซ้ำ
  if (dupes.length) {
    const ids = dupes.map((d: any) => d.id);
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      console.log("  ลบซ้ำ " + (await prisma.material.deleteMany({ where: { id: { in: part } } })).count + " รายการ");
    }
  }

  // 3) ลบขยะ
  const ids = junk.map((j) => j.id);
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    // chunks ถูกลบ cascade อยู่แล้วตาม schema
    const r = await prisma.material.deleteMany({ where: { id: { in: part } } });
    console.log("  ลบขยะ " + r.count + " รายการ");
  }

  // เก็บกวาดไฟล์บนดิสก์ที่ไม่มี material อ้างอิงแล้ว
  const orphan = await prisma.material.findMany({ select: { filePath: true } });
  const live = new Set(orphan.map((m: any) => m.filePath).filter(Boolean));
  fs.mkdirSync(path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), "storage", "materials")), { recursive: true });
  const mediaDir = path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), "storage", "materials"));
  let freed = 0;
  for (const f of fs.readdirSync(mediaDir)) {
    const full = path.join(mediaDir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (!live.has(full)) { fs.unlinkSync(full); freed++; }
  }
  console.log("ลบไฟล์ที่ไม่มีใครอ้างอิงแล้ว: " + freed + " ไฟล์");

  const after = await prisma.material.count();
  console.log("เหลือ materials: " + after);
  await prisma.$disconnect();
})();
