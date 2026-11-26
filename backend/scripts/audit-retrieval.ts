/**
 * ตรวจคุณภาพการค้นหลักฐานของ AI Tutor แบบไม่ใช้โควตา LLM
 *
 * วิธีทดสอบ: สร้างคำถามจาก "ชื่อไฟล์" และ "วลาหายากในเนื้อหา" ของแต่ละวิชา
 * แล้วดูว่า retrieve() จัดอันดับเอกสารต้นทางได้ติด top หรือไม่
 *   - title probe: ถามด้วยชื่อไฟล์ → ต้องติด top 3
 *   - content probe: ถามด้วยวลาหายากจาก chunk → ต้องติด top 5
 *
 * รัน: npx ts-node scripts/audit-retrieval.ts [--subject=<คำในชื่อวิชา>] [--verbose]
 */
import "dotenv/config";
import { prisma } from "../src/auth";
import { retrieve } from "../src/routes/tutor";
import { embeddingStats } from "../src/lib/embeddings";

const args = process.argv.slice(2);
const filter = args.find((a) => a.startsWith("--subject="))?.split("=")[1] || "";
const verbose = args.includes("--verbose");

type Probe = { kind: "title" | "content"; question: string; title: string };

const normalizeTitle = (title: string) =>
  String(title || "")
    .replace(/\.(pdf|txt|pptx|docx|mp4|m4a)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function thaiRuns(text: string) {
  return (String(text || "").match(/[ก-๙]{8,}/g) || []);
}

function rarePhrase(materialChunks: { content: string }[], allChunks: { content: string }[]) {
  for (const chunk of materialChunks.slice(0, 15)) {
    for (const run of thaiRuns(chunk.content)) {
      const phrase = run.slice(0, 8);
      if (phrase.length < 8) continue;
      let df = 0;
      for (const other of allChunks) if (String(other.content).includes(phrase)) df++;
      if (df <= 2) return phrase;
    }
  }
  return null;
}

(async () => {
  const user = await prisma.user.findFirst({
    orderBy: { subjects: { _count: "desc" } },
    select: { id: true, name: true },
  });
  if (!user) {
    console.log("ไม่พบผู้ใช้");
    process.exit(0);
  }
  const stats = await embeddingStats();
  console.log(`ผู้ใช้: ${user.name} | embedding ${stats.total - stats.missing}/${stats.total}\n`);

  const subjects = await prisma.subject.findMany({
    where: { userId: user.id, ...(filter ? { name: { contains: filter } } : {}) },
    orderBy: { name: "asc" },
    include: { materials: { where: { status: "COMPLETED" }, include: { chunks: { orderBy: { chunkIndex: "asc" } } } } },
  });

  let titlePass = 0, titleTotal = 0, contentPass = 0, contentTotal = 0;
  const problems: string[] = [];

  for (const subject of subjects) {
    const materials = subject.materials.filter((m) => m.chunks.length);
    if (!materials.length) {
      console.log(`- ${subject.name}: (ไม่มีเนื้อหา)`);
      continue;
    }
    const allChunks = materials.flatMap((m) => m.chunks);
    const withVector = allChunks.filter((c) => c.embedding).length;

    // รวมไฟล์ชื่อซ้ำ ( Classroom บางวิชามีชื่อไฟล์เดียวกันหลายรายการ )
    const byTitle = new Map<string, typeof materials[number]>();
    for (const m of [...materials].sort((a, b) => b.chunks.length - a.chunks.length)) {
      const key = normalizeTitle(m.title);
      if (!byTitle.has(key)) byTitle.set(key, m);
    }

    const probes: Probe[] = [];
    for (const material of [...byTitle.values()].slice(0, 3)) {
      const title = material.title.replace(/\.(pdf|txt|pptx|docx|mp4|m4a)$/i, "").slice(0, 70);
      probes.push({ kind: "title", question: `${title} เกี่ยวกับอะไร`, title: material.title });
      const phrase = rarePhrase(material.chunks, allChunks);
      if (phrase) probes.push({ kind: "content", question: `"${phrase}" คืออะไร`, title: material.title });
    }

    let subjectMiss = 0;
    const details: string[] = [];
    for (const probe of probes) {
      const started = Date.now();
      const result = await retrieve(subject.id, user.id, probe.question, 8);
      const ms = Date.now() - started;
      const order: string[] = [];
      for (const hit of result.ranked) {
        const key = normalizeTitle(hit.m.title);
        if (!order.includes(key)) order.push(key);
      }
      const rank = order.indexOf(normalizeTitle(probe.title)) + 1; // 0 = ไม่ติด
      const limitRank = probe.kind === "title" ? 3 : 5;
      const ok = rank > 0 && rank <= limitRank;
      if (probe.kind === "title") { titleTotal++; if (ok) titlePass++; }
      else { contentTotal++; if (ok) contentPass++; }
      if (!ok) {
        subjectMiss++;
        problems.push(
          `${subject.name} | ${probe.kind} | "${probe.question}" → ${rank ? "อันดับ " + rank : "ไม่ติด"} (คาด: ${probe.title})`
        );
      }
      if (verbose) details.push(`   ${ok ? "OK  " : "MISS"} [${probe.kind}] rank=${rank || "-"} ${ms}ms | ${probe.question}`);
    }

    const coverage = Math.round((withVector / allChunks.length) * 100);
    console.log(`- ${subject.name}: ${probes.length} probes, พลาด ${subjectMiss} | chunk ${allChunks.length}, เวกเตอร์ ${coverage}%`);
    if (verbose) details.forEach((d) => console.log(d));
  }

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  console.log(`\nสรุป: title ${titlePass}/${titleTotal} (${pct(titlePass, titleTotal)}%) | content ${contentPass}/${contentTotal} (${pct(contentPass, contentTotal)}%)`);
  if (problems.length) {
    console.log("\nจุดที่พลาด:");
    problems.forEach((p) => console.log("  " + p));
  }
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error?.message || error);
  process.exit(1);
});
