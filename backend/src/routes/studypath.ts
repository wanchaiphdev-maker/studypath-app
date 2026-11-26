import { Router } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";
import { prisma, requireAuth } from "../auth";
import { sortByTitle } from "../lib/natural-sort";
import { letterCount, NON_TEXT_CHAR_RE, hasSubstantiveContent, contentQuality, isGenericTitle, ADMIN_NAME_RE, CASUAL_CHATTER_RE, CHATTER_FIRST_RE } from "../filters/classroom-filters";
import { buildSubjectTopics } from "./tutor";
import { embedMaterial } from "../lib/embeddings";

/** แยกประโยคที่ยาวพอจะตั้งเป็นโจทย์เติมคำได้ */
/** เลขหน้า/หัวกระดาษที่ OCR ติดมากับเนื้อหา เช่น "-- 3 of 12 --" — ตัดทิ้งก่อนตั้งโจทย์ */
const PAGE_MARKER_RE = /[-–—]{0,3}\s*\b\d+\s*of\s*\d+\b\s*[-–—]{0,3}/gi;

function splitSentences(text: string): string[] {
  return String(text || "")
    .replace(PAGE_MARKER_RE, " ")
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((x) => x.replace(/\s{2,}/g, " ").trim())
    .filter((x) => x.length >= 30);
}

/**
 * ไฟล์ที่มีแต่ "เมตาดาที่ชี้ไปที่ Google Drive" ไม่มีเนื้อหาจริง
 * เช่น textContent = "เปิดไฟล์ต้นฉบับเพื่อดูเนื้อหา: https://drive.google.com/file/d/..."
 * ใช้เป็นแหล่งทำโจทย์ไม่ได้ เพราะจะได้คำถามออกมาเป็นลิงก์
 */
/**
 * บรรทัดที่นำไปเป็น "แนวคิด" ได้จริงไหม
 * ต้องเป็นชื่อเรื่อง/คำศัพท์ ไม่ใช่ข้อความจากนิสิตหรือข้อความประกาศ
 */
function isConceptLine(line: string) {
  const t = line.replace(/\s+/g, " ").trim();
  if (!t || t.length > 70) return false;
  if (/[.!?;,]$/.test(t)) return false;
  if (letterCount(t) < 6) return false;
  if (/^https?:\/\//.test(t)) return false;
  // page marker ของตัวดึงข้อความ PDF เช่น "-- 3 of 12 --"
  if (/^-{1,2}\s*\d+\s*(of|จาก)\s*\d+\s*-{1,2}$/i.test(t)) return false;
  if (/\d+\s*(of|จาก)\s*\d+\s*--/i.test(t)) return false;
  if (/^(page|หน้า|chapter|บทที่|week|slide|ที่)\s*\d+/i.test(t)) return false;
  // แชท/ประกาศ — ต้องไม่หลุดมาเป็นแนวคิด
  if (/(ขออนุญาต|รหัสนิสิต|รหัส\s*\d{9,}|นะคะ|นะครับ|ค้าบ|ครับทราบ|รับทราบ|มั้ย|จ้า|ขอบคุณ)/.test(t)) return false;
  if (ADMIN_NAME_RE.test(t) || CASUAL_CHATTER_RE.test(t) || CHATTER_FIRST_RE.test(t)) return false;
  // ตัวเลขยาว ๆ = รหัสนักศึกษา ไม่ใช่ชื่อเรื่อง
  if (/(^|\s)\d{6,}(\s|$)/.test(t)) return false;
  return true;
}

export function isLinkOnly(text: string) {
  const t = String(text || "").trim();
  if (!t) return true;
  const real = t
    .split(/\n+/)
    .filter((line) => !/https?:\/\/|เปิดไฟล์ต้นฉบับ|ไฟล์ต้นฉบับ|ไฟล์แนบจาก Google Classroom|หากเปิดไม่ได้/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return letterCount(real) < 40;
}

/**
 * ขยะจาก OCR: เลขหน้าของไฟล์ PDF หลายหน้าติดกันเป็นประโยคเดียว
 * เช่น "Chapter 4 -- 1 of 32 -- ... -- 32 of 32 --" (ตัวอักษรเยอะจนผ่านตัวกรองปกติ)
 * ถ้าตัด marker ออกแล้วเหลือเนื้อหาจริงน้อย = ใช้ตั้งโจทย์ไม่ได้
 */
function isPageMarkerNoise(s: string): boolean {
  const hits = s.match(/\b\d+\s*(?:of|\/)\s*\d+\b/gi) || [];
  // เจอ "N of M" ตั้งแต่ 3 ครั้งขึ้นไป = เนื้อหาจริงแทบไม่มีทางเป็นแบบนี้ (เป็นเลขหน้าต่อกัน)
  if (hits.length >= 3) return true;
  if (hits.length < 2) return false;
  const rest = s
    .replace(/\b\d+\s*(?:of|\/)\s*\d+\b/gi, " ")
    .replace(/[-–—_=.*|]+/g, " ")
    .replace(/หน้า|page|ตอนที่|บทที่/gi, " ")
    .trim();
  const words = rest.split(/\s+/).filter(Boolean);
  return letterCount(rest) < 60 || words.length < 12;
}

/**
 * ประโยคที่เอาไปตั้งเป็นโจทย์เติมคำได้จริง
 * ตัด: ตารางตัวเลขล้วน, บรรทัดสั้น, ข้อความที่ไม่มีตัวอักษรพอ
 * (เช่น "5 x 1001 x 1011 x 1023 x 1032 x 104 + + + +" ตัดเลขจากสไลด์)
 */
function usableSentence(s: string): boolean {
  const letters = letterCount(s);
  if (letters < 20) return false;
  if (isPageMarkerNoise(s)) return false;                   // เลขหน้า PDF/OCR ปนมาหลายหน้า = ขยะ
  if (letters / s.length < 0.4) return false;              // ตัวเลขเยอะเกิน = ตาราง
  if ((s.match(/[+×÷=]/g) || []).length >= 3) return false; // สมการยาวเกิน
  if (/^[\d\s.,+\-*/=%_$#|]+$/.test(s)) return false;       // ไม่มีตัวอักษรเลย
  return true;
}

/**
 * หมุนเวียนไฟล์เป็นรอบ ๆ เพื่อให้ทุกไฟล์ที่ผู้ใช้เลือกได้โจทย์ครบ
 * คืนชุดประโยครวมไม่เกิน wanted ข้อ
 */
function splitSentencesByFile(
  sources: { id: string; title: string; textContent: string }[],
  ok: (s: string) => boolean,
  wanted: number,
) {
  const pool = sources.map((m) => ({
    material: m,
    list: splitSentences(String(m.textContent || "")).filter(ok),
  })).filter((p) => p.list.length > 0);
  if (!pool.length) return [];

  const out: { text: string; material: any }[] = [];
  const used = new Map<string, number>();
  let round = 0;
  while (out.length < wanted && round < 40) {
    let added = false;
    for (const p of pool) {
      if (out.length >= wanted) break;
      const at = used.get(p.material.id) ?? 0;
      if (at >= p.list.length) continue;
      used.set(p.material.id, at + 1);
      out.push({ text: p.list[at], material: p.material });
      added = true;
    }
    if (!added) break;   // ทุกไฟล์หมดแล้ว
    round++;
  }
  return out;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/x-wav",
      "audio/webm",
      "audio/ogg",
      "video/mp4",
      "video/webm",
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), "storage", "materials"));
fs.mkdirSync(MEDIA_DIR, { recursive: true });

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

function extractPptxText(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => {
      const na = Number(a.entryName.match(/slide(\d+)/i)?.[1] || 0);
      const nb = Number(b.entryName.match(/slide(\d+)/i)?.[1] || 0);
      return na - nb;
    })
    .map((entry, index) => {
      const xml = entry.getData().toString("utf8");
      const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) =>
        m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      );
      return "[สไลด์ " + (index + 1) + "] " + texts.join(" ");
    })
    .filter((x) => x.length > 10)
    .join("\n\n");
}

/** ถอดเสียงไฟล์เสียง/วิดีโอ
 *  - ถ้าตั้ง AI_TRANSCRIBE_BASE_URL (OpenAI/Whisper) → ใช้ /audio/transcriptions
 *  - ไม่งั้นใช้ Gemini native (generateContent + inlineData) ซึ่งรองรับเสียงโดยตรง
 *    (AI_BASE_URL ของโปรเจกต์เป็น Gemini OpenAI-compat ที่ไม่มี /audio/transcriptions → 404)
 */
async function transcribeAudio(buffer: Buffer, filename: string, mimeType: string) {
  // 1) ผู้ให้บริการแบบ OpenAI/Whisper (ถ้าตั้งไว้)
  const openaiBase = process.env.AI_TRANSCRIBE_BASE_URL?.replace(/\/$/, "");
  const openaiKey = process.env.AI_TRANSCRIBE_API_KEY || process.env.AI_API_KEY;
  if (openaiBase && openaiKey) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    form.append("model", process.env.AI_TRANSCRIBE_MODEL || "whisper-1");
    const response = await fetch(openaiBase + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + openaiKey },
      body: form,
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error("Transcription provider error " + response.status);
    const body: any = await response.json();
    return String(body?.text || "").trim() || null;
  }

  // 2) Gemini native (ใช้ AI_API_KEY เดิม)
  const key = process.env.AI_API_KEY;
  if (!key) return null;
  if (buffer.length > 18 * 1024 * 1024) {
    throw new Error("ไฟล์เสียงใหญ่เกิน 18MB — กรุณาตัดเป็นท่อนสั้นลงก่อนอัปโหลด");
  }
  const model = process.env.GEMINI_TRANSCRIBE_MODEL || process.env.AI_MODEL || "gemini-3.5-flash-lite";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: buffer.toString("base64") } },
            { text: "ถอดเสียงในไฟล์นี้เป็นข้อความตามที่ได้ยินทั้งหมด ห้ามสรุปหรือแต่งเติม ถ้าฟังไม่ชัดให้ใส่ [ไม่ได้ยิน]" },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 32768 },
      }),
      signal: AbortSignal.timeout(180000),
    }
  );
  if (!response.ok) throw new Error("Transcription provider error " + response.status);
  const body: any = await response.json();
  const text = (body?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || "")
    .join("")
    .trim();
  return text || null;
}

const router = Router();

async function groundedModelAnswer(question: string, context: string) {
  const endpoint = process.env.AI_BASE_URL?.replace(/\/$/, "");
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!endpoint || !key || !model) return null;
  const response = await fetch(endpoint + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: "Answer only from the supplied study sources. If the sources do not support the answer, say that there is not enough evidence. Do not invent citations." },
        { role: "user", content: "Question:\n" + question + "\n\nStudy sources:\n" + context },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("AI provider error " + response.status);
  const body: any = await response.json();
  return body?.choices?.[0]?.message?.content?.trim() || null;
}

router.get("/curriculum", requireAuth(), async (req: any, res) => {
  const years = await prisma.academicYear.findMany({
    where: { userId: req.user.id },
    orderBy: { order: "asc" },
    include: { semesters: { orderBy: { order: "asc" }, include: { subjects: true } } },
  });
  res.json(years);
});

router.post("/curriculum/years", requireAuth(), async (req: any, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: "กรุณาระบุปีการศึกษา" });
  const order = await prisma.academicYear.count({ where: { userId: req.user.id } });
  res.status(201).json(await prisma.academicYear.create({ data: { name, order, userId: req.user.id } }));
});

router.post("/curriculum/semesters", requireAuth(), async (req: any, res) => {
  const academicYearId = String(req.body?.academicYearId || "").trim();
  const name = String(req.body?.name || "").trim().slice(0, 100);
  if (!academicYearId || !name) return res.status(400).json({ error: "ข้อมูลภาคการศึกษาไม่ครบ" });
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, userId: req.user.id } });
  if (!year) return res.status(404).json({ error: "ไม่พบปีการศึกษา" });
  const order = await prisma.semester.count({ where: { academicYearId } });
  res.status(201).json(await prisma.semester.create({ data: { name, order, academicYearId, userId: req.user.id } }));
});

router.get("/subjects", requireAuth(), async (req: any, res) => {
  res.json(await prisma.subject.findMany({
    where: { userId: req.user.id }, orderBy: { name: "asc" },
    include: { semester: { include: { academicYear: true } }, _count: { select: { materials: true, quizzes: true } } },
  }));
});

router.post("/subjects", requireAuth(), async (req: any, res) => {
  const semesterId = String(req.body?.semesterId || "").trim();
  const name = String(req.body?.name || "").trim().slice(0, 160);
  if (!semesterId || !name) return res.status(400).json({ error: "กรุณาระบุภาคการศึกษาและชื่อวิชา" });
  const semester = await prisma.semester.findFirst({ where: { id: semesterId, userId: req.user.id } });
  if (!semester) return res.status(404).json({ error: "ไม่พบภาคการศึกษา" });
  const subject = await prisma.subject.create({ data: { semesterId, userId: req.user.id, name, code: String(req.body?.code || "").trim() || null } });
  await prisma.learningProgress.create({ data: { userId: req.user.id, subjectId: subject.id } });
  res.status(201).json(subject);
});

router.get("/subjects/:subjectId", requireAuth(), async (req: any, res) => {
  const subject = await prisma.subject.findFirst({
    where: { id: req.params.subjectId, userId: req.user.id },
    include: { semester: { include: { academicYear: true } }, materials: true, progress: true },
  });
  if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
  // เรียงตามลำดับบท/สัปดาห์ ไม่ใช่ตามลำดับที่ซิงก์เข้ามา
  // (ไม่งั้น Chapter 8 จะโผล่ก่อน Chapter 1 และ WEEK#14 ก่อน WEEK#2)
  res.json({ ...subject, materials: sortByTitle(subject.materials) });
});

router.post("/materials/upload", requireAuth(), upload.single("file"), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const title = String(req.body?.title || req.file?.originalname || "เอกสารการเรียน").trim().slice(0, 200);
    if (!subjectId) return res.status(400).json({ error: "กรุณาระบุวิชา" });
    if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์ PDF, PPTX, TXT หรือไฟล์บันทึกเสียง" });

    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    const isAudio = req.file.mimetype.startsWith("audio/") || req.file.mimetype.startsWith("video/");
    const isPptx = req.file.mimetype.includes("presentationml") || /\.pptx?$/i.test(req.file.originalname);
    let textContent = "";
    let pageCount: number | undefined;
    let transcript: string | null = null;
    let sourceLabel = "เอกสารการเรียน";
    if (isAudio) {
      const savedName = Date.now() + "-" + req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const savedPath = path.join(MEDIA_DIR, savedName);
      fs.writeFileSync(savedPath, req.file.buffer);
      transcript = await transcribeAudio(req.file.buffer, req.file.originalname, req.file.mimetype);
      if (!transcript) return res.status(422).json({ error: "บันทึกเสียงถูกเก็บไว้แล้ว แต่ยังถอดเสียงไม่ได้ กรุณาตั้งค่า AI_BASE_URL และ AI_API_KEY สำหรับระบบ Transcription" });
      textContent = "[บันทึกเสียงในชั้นเรียน]\\n" + transcript;
      sourceLabel = "Lecture Recording";
      const chunks = chunkText(textContent);
      const material = await prisma.material.create({
        data: { category: "slide", title, fileName: req.file.originalname.slice(0,255), mimeType: req.file.mimetype, sourceType: "LECTURER", status: "COMPLETED", textContent, transcript, filePath: savedPath, sourceLabel, userId: req.user.id, subjectId, chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } },
        include: { chunks: true },
      });
      await prisma.subject.update({ where: { id: subjectId }, data: { status: "IN_PROGRESS" } });
      void embedMaterial(material.id).catch(() => undefined);
      return res.status(201).json({ id: material.id, title: material.title, status: material.status, chunkCount: material.chunks.length, sourceLabel, transcriptAvailable: true });
    }
    if (isPptx) {
      textContent = extractPptxText(req.file.buffer);
      sourceLabel = "Lecture Slides";
    } else if (req.file.mimetype === "application/pdf") {
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      textContent = String(result.text || "").trim();
      pageCount = Number(result.total || 0) || undefined;
      await parser.destroy();
      sourceLabel = "PDF Lecture Material";
    } else {
      textContent = req.file.buffer.toString("utf8").trim();
      sourceLabel = "Lecture Note";
    }
    if (textContent.length < 20) return res.status(422).json({ error: "ไฟล์นี้ไม่มีข้อความที่อ่านได้เพียงพอ หากเป็น PDF สแกนภาพให้ใช้ OCR เพิ่มเติม" });
    const chunks = chunkText(textContent);
    const savedName = Date.now() + "-" + req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const savedPath = path.join(MEDIA_DIR, savedName);
    fs.writeFileSync(savedPath, req.file.buffer);
    const material = await prisma.material.create({
      data: { category: "slide", title, fileName: req.file.originalname.slice(0,255), mimeType: req.file.mimetype, sourceType: "LECTURER", status: "COMPLETED", textContent, pageCount, filePath: savedPath, sourceLabel, userId: req.user.id, subjectId, chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } },
      include: { chunks: true },
    });
    await prisma.subject.update({ where: { id: subjectId }, data: { status: "IN_PROGRESS" } });
    void embedMaterial(material.id).catch(() => undefined);
    res.status(201).json({ id: material.id, title: material.title, fileName: material.fileName, status: material.status, pageCount: material.pageCount, chunkCount: material.chunks.length, sourceLabel });
  } catch (error) {
    console.error("StudyPath material upload failed", error);
    res.status(500).json({ error: "ประมวลผล Learning Material ไม่สำเร็จ: " + String(error instanceof Error ? error.message : error) });
  }
});


router.post("/materials", requireAuth(), async (req: any, res) => {
  const subjectId = String(req.body?.subjectId || "").trim();
  const textContent = String(req.body?.textContent || "").trim();
  const title = String(req.body?.title || "เอกสารการเรียน").trim().slice(0, 200);
  if (!subjectId || !textContent) return res.status(400).json({ error: "กรุณาระบุวิชาและเนื้อหา" });
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
  if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
  const parts = textContent.split(/(?<=[.!?。！？])\s+|\n+/).map((x: string) => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if ((current + " " + part).trim().length > 1200 && current) { chunks.push(current.trim()); current = part; }
    else current = (current + " " + part).trim();
  }
  if (current) chunks.push(current);
  const material = await prisma.material.create({
    data: {
      title, fileName: null, mimeType: "text/plain",
      category: "slide",
      sourceType: "IMPORTED", status: "COMPLETED", textContent,
      userId: req.user.id, subjectId,
      chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) },
    },
    include: { chunks: true },
  });
  await prisma.subject.update({ where: { id: subjectId }, data: { status: "IN_PROGRESS" } });
  res.status(201).json({ id: material.id, title: material.title, status: material.status, chunkCount: material.chunks.length });
});

router.post("/materials/:materialId/ask", requireAuth(), async (req: any, res) => {
  const question = String(req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "กรุณาพิมพ์คำถาม" });
  const material = await prisma.material.findFirst({ where: { id: req.params.materialId, userId: req.user.id } });
  if (!material) return res.status(404).json({ error: "ไม่พบเอกสาร" });
  const materials = await prisma.material.findMany({
    where: { subjectId: material.subjectId, userId: req.user.id, status: "COMPLETED" },
    include: { chunks: true },
    orderBy: { createdAt: "asc" },
  });
  const q = new Set(question.toLowerCase().split(/\s+/).filter((x: string) => x.length > 1));
  const ranked = materials.flatMap((m) => m.chunks.map((chunk) => {
    const words = chunk.content.toLowerCase().split(/\s+/);
    const score = words.reduce((n: number, word: string) => n + (q.has(word.replace(NON_TEXT_CHAR_RE, "")) ? 1 : 0), 0);
    return { material: m, chunk, score };
  })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  if (!ranked.length) return res.json({
    grounded: false,
    answer: "ยังไม่พบข้อมูลที่ตรงกับคำถามในเนื้อหาของวิชานี้ กรุณาเพิ่มสไลด์หรือบันทึกเสียงการเรียนที่เกี่ยวข้อง",
    sources: [],
  });
  const sources = ranked.map((x) => ({
    materialId: x.material.id,
    title: x.material.title,
    sourceLabel: x.material.sourceLabel,
    chunk: x.chunk.chunkIndex + 1,
    excerpt: x.chunk.content.slice(0, 220),
  }));
  const context = ranked.map((x) => "[" + (x.material.sourceLabel || "Learning Material") + " | " + x.material.title + " | chunk " + (x.chunk.chunkIndex + 1) + "] " + x.chunk.content).join("\n\n");
  let answer = ranked.map((x) => x.chunk.content).join("\n\n");
  let mode = "grounded-retrieval";
  try {
    const modelAnswer = await groundedModelAnswer(question, context);
    if (modelAnswer) { answer = modelAnswer; mode = "grounded-llm"; }
  } catch (error) {
    console.warn("AI provider unavailable; using grounded retrieval fallback", error);
  }
  res.json({ grounded: true, mode, answer, sources, sourceCount: sources.length, knowledgeBase: "all-materials-in-subject" });
});


router.post("/subjects/:subjectId/quizzes/generate", requireAuth(), async (req: any, res) => {
  const subjectId = String(req.params.subjectId || "");
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
  if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

  // ผู้ใช้เลือกเนื้อหามาเองก่อน -> ใช้เฉพาะที่เลือก ห้ามไปล้างวิชาอื่น
  const picked: string[] = Array.isArray(req.body?.materialIds)
    ? req.body.materialIds.map((x: any) => String(x)).filter(Boolean)
    : [];

  const all = await prisma.material.findMany({
    where: { subjectId: subject.id, userId: req.user.id, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  // ไฟล์ที่มีแต่ลิงก์ไปที่ Google Drive = ไม่มีเนื้อหา ใช้ทำโจทย์ไม่ได้
  const usable = all.filter((m: any) => !isLinkOnly(m.textContent));
  if (!all.length) return res.status(422).json({ error: "กรุณาเพิ่มเอกสารก่อนสร้าง Quiz" });
  if (!usable.length) return res.status(422).json({
    error: "ไฟล์ในวิชานี้เปิดอ่านข้อความไม่ได้ (เป็นสไลด์รูปภาพหรือไฟล์ลิงก์) — ต้องมีไฟล์ที่เป็นข้อความจริงก่อน",
  });

  let sources: typeof all;
  if (picked.length) {
    const allow = new Set(picked);
    sources = usable.filter((m: any) => allow.has(m.id));
    if (!sources.length) return res.status(422).json({ error: "ไฟล์ที่เลือกไม่มีเนื้อหาข้อความให้ทำโจทย์" });
  } else {
    // ไม่ได้เลือก = ใช้ทั้งวิชา แต่เรียงตามชื่อให้เป็นลำดับบท/สัปดาห์
    sources = sortByTitle(usable);
  }

  // ดึงประโยคจากทุกไฟล์ที่เลือก โดยหมุนเวียนไฟล์เป็นรอบ
  const wanted = Math.min(Math.max(Number(req.body?.count) || 8, 1), 30);

  /**
   * "เก็บโจทย์ที่ทำไว้เอาไปทำในโหมดข้อสอบ"
   * ดึงประโยคจาก "งานที่นักศึกษาเคยส่ง" ของรายการประเภท การบ้าน/งานในห้อง/โบนัส
   * เพื่อให้ข้อสอบอ้างอิงวิธีทำจริงของตัวเอง ไม่ใช่แค่เนื้อหาในสไลด์
   *
   * ต้องจองโควตาไว้ก่อน ไม่งั้นประโยคจากสไลด์จะเต็มและตัดงานของเราทิ้ง
   */
  const ASSIGNMENT_CATS = ["homework", "inclass", "bonus"];
  // ใช้ all ไม่ใช่ usable เพราะไฟล์งานมักเป็น "คำสั่งงาน" สั้นๆ ที่ถูกตัดออกจาก usable
  // แต่ชื่อของมันคือกุญแจที่จะจับคู่กับงานที่นักศึกษาส่งมา
  const assignmentTitles = all
    .filter((m: any) => ASSIGNMENT_CATS.includes(m.category))
    .map((m: any) => String(m.title || "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((t: string) => t.length >= 6);
  const fromMyWork: { text: string; material: any }[] = [];
  if (assignmentTitles.length) {
    const subs = await prisma.submission.findMany({
      where: { subjectId: subject.id, userId: req.user.id },
      orderBy: { submittedAt: "desc" }, take: 60,
    });
    const quota = Math.min(4, Math.max(1, Math.round(wanted / 3)));
    for (const sub of subs) {
      if (fromMyWork.length >= quota) break;
      const st = String(sub.title || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!st || !assignmentTitles.some((t) => st.includes(t) || t.includes(st))) continue;
      for (const s of splitSentences(sub.textContent).filter(usableSentence)) {
        // บรรทัดที่เป็นแค่ชื่อไฟล์/ลิงก์ ไม่ใช่สิ่งที่นักศึกษาเขียน
        if (/^\[?\s*(จากไฟล์|ไฟล์แนบ|ลิงก์ที่ส่ง|แนบลิงก์)/.test(s)) continue;
        if (/https?:\/\//.test(s)) continue;
        fromMyWork.push({ text: s, material: { id: "", title: String(sub.title || ""), __fromSubmission: true } });
        if (fromMyWork.length >= quota) break;
      }
    }
  }

  // ดึงประโยคจากไฟล์ที่เลือก โดยหมุนเวียนไฟล์เป็นรอบ
  // (ถ้าใช้ perFile ตายตัว ไฟล์ที่ไม่มีประโยคพอจะทำให้ไฟล์อื่นถูกล้มทิ้ง)
  const perFile = splitSentencesByFile(sources, usableSentence, Math.max(1, wanted - fromMyWork.length));
  if (!perFile.length && !fromMyWork.length) {
    return res.status(422).json({ error: "เนื้อหาที่เลือกยังสั้นเกินไปสำหรับสร้าง Quiz" });
  }
  // งานที่ตัวเองทำไว้ขึ้นก่อน เพราะเป็นสิ่งที่ต้องทบทวนจริง
  const pickedSentences: { text: string; material: any }[] = [...fromMyWork, ...perFile];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const STOP = /^(และ|หรือ|แต่|ที่|ซึ่ง|ใน|ของ|โดย|ให้|จะ|เป็น|ได้|มี|คือ|ก็|ยัง|แล้ว|การ|นี้|ๆ|จาก|กับ|เมื่อ|ถ้า|โดย|วิธี|เพื่อ|ซึ่ง|อีก|ยัง|คือ|แต่ละ|ทุก|บาง|มาก|น้อย|โดยตรง|ต้อง|ควร|แล้วก็)$/i;
  // ประโยคที่เหมาะกับโจทย์เติมคำ: ต้องมีตัวอักษร ไม่ใช่ตารางตัวเลขล้วน

  const questions = pickedSentences.slice(0, wanted).map((item, index) => {
    const sentence = item.text;
    const material = item.material;

    // เลือกคำที่จะทำเป็นช่องว่าง — ต้องเป็นคำนาม/คำสำคัญที่มีความหมาย
    // เลี่ยงคำที่เป็น "คำตอบ" (จากข้อความ เช่น "กรอกคำตอบ") และคำทั่วไป
    const raw = sentence.split(/\s+/);
    const candidates: { word: string; index: number }[] = [];
    raw.forEach((w, i) => {
      const clean = w.replace(/[.,!?;:()[\]{}"']/g, "");
      if (clean.length < 4) return;
      if (STOP.test(clean)) return;
      if (/^คำตอบ$|^คำถาม$|^blank$/i.test(clean)) return;
      if (!/(?:\p{L}\p{M}*){3,}/u.test(clean)) return;
      candidates.push({ word: clean, index: i });
    });
    if (!candidates.length) return null;

    // เลือกคำกลางๆ ของประโยค (ไม่ใช่คำแรก/ท้าย) แล้วลองสลับไปคำที่ถัดไปถ้าคำแรกซ้ำกับตัวอื่น
    const pick = candidates[Math.floor(candidates.length / 2)] || candidates[0];
    const answer = pick.word;
    const blanked = raw.slice();
    blanked[pick.index] = "_____";
    const prompt = blanked.join(" ").replace(/\s{2,}/g, " ").trim();

    // ตัวเลือกหลอก: ดึงคำจริงจากแหล่งเดียวกัน ยกเว้นคำที่ปรากฏในประโยคนี้
    const sentenceWords = new Set(raw.map((w) => norm(w.replace(/[.,!?;:()[\]{}"']/g, ""))));
    // ข้อที่มาจากงานที่นักศึกษาทำเอง ให้ดึงคำหลอกจากประโยคอื่นของงานเดียวกัน
    const distractorSource = material.__fromSubmission
      ? pickedSentences.filter((x) => x.material.__fromSubmission).map((x) => x.text).join(" ")
      : String(material.textContent || "");
    const pool = distractorSource.split(/\s+/)
      .map((w: string) => w.replace(/[.,!?;:()[\]{}"']/g, ""))
      .filter((w: string) => w.length >= 4 && !STOP.test(w) && /(?:\p{L}\p{M}*){3,}/u.test(w));
    const distractors: string[] = [];
    const seen = new Set([norm(answer)]);
    for (const w of pool) {
      if (distractors.length >= 3) break;
      const k = norm(w);
      if (seen.has(k) || sentenceWords.has(k)) continue;   // ต้องไม่อยู่ในประโยค ไม่งั้นเดาง่ายเกิน
      seen.add(k);
      distractors.push(w);
    }
    for (const f of ["ไม่มีข้อมูล", "ไม่เกี่ยวข้อง", "ข้อมูลไม่เพียงพอ"]) {
      if (distractors.length >= 3) break;
      if (seen.has(norm(f))) continue;
      seen.add(norm(f));
      distractors.push(f);
    }
    // หมุนตำแหน่งคำตอบ ไม่ให้อยู่ที่เดิมทุกข้อ
    const options = [answer, ...distractors];
    const shift = index % options.length;
    const rotated = [...options.slice(shift), ...options.slice(0, shift)];

    const fromMyWork = !!material.__fromSubmission;
    return {
      type: "MULTIPLE_CHOICE" as const,
      prompt: (fromMyWork ? "จากสิ่งที่คุณทำ: " : "เติมข้อความจากเอกสาร: ") + prompt,
      options: rotated,
      answer,
      explanation: (fromMyWork ? "อ้างอิงจากงานที่คุณส่ง: " : "อ้างอิงจาก ") + material.title.replace(/^สิ่งที่คุณทำ:\s*/, ""),
      source: { materialId: material.id || null, materialTitle: material.title, chunk: index + 1, fromMyWork },
      order: index,
    };
  }).filter(Boolean) as any[];

  const label = picked.length
    ? (sources.length === 1 ? sources[0].title : sources.length + " ไฟล์ที่เลือก")
    : "ทั้งวิชา";
  const quiz = await prisma.quiz.create({
    data: {
      title: "ฝึกทำความเข้าใจ: " + subject.name + " (" + label + ")",
      subjectId: subject.id,
      userId: req.user.id,
      questions: { create: questions },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  res.status(201).json({ ...quiz, usedMaterialIds: sources.map((s: any) => s.id), usedMaterialCount: sources.length });
});

router.get("/quizzes/:quizId", requireAuth(), async (req: any, res) => {
  const quiz = await prisma.quiz.findFirst({ where: { id: req.params.quizId, userId: req.user.id }, include: { questions: { orderBy: { order: "asc" } }, subject: true } });
  if (!quiz) return res.status(404).json({ error: "ไม่พบ Quiz" });
  res.json(quiz);
});

router.post("/quizzes/:quizId/attempt", requireAuth(), async (req: any, res) => {
  const quiz = await prisma.quiz.findFirst({ where: { id: req.params.quizId, userId: req.user.id }, include: { questions: true } });
  if (!quiz) return res.status(404).json({ error: "ไม่พบ Quiz" });
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const mistakes: any[] = [];
  let correct = 0;
  for (const question of quiz.questions) {
    const given = String(answers.find((x: any) => x.questionId === question.id)?.answer || "").trim();
    if (given && given.toLowerCase() === question.answer.toLowerCase()) correct++;
    else mistakes.push({ questionId: question.id, expected: question.answer, given });
  }
  const score = Math.round((correct / quiz.questions.length) * 100);
  await prisma.attempt.create({ data: { quizId: quiz.id, userId: req.user.id, score, answers, mistakes } });
  const current = await prisma.learningProgress.findUnique({ where: { userId_subjectId: { userId: req.user.id, subjectId: quiz.subjectId } } });
  const mastery = Math.round((((current?.mastery || 0) * 0.7) + score * 0.3) * 10) / 10;
  await prisma.learningProgress.upsert({
    where: { userId_subjectId: { userId: req.user.id, subjectId: quiz.subjectId } },
    create: { userId: req.user.id, subjectId: quiz.subjectId, mastery, evidence: { latestScore: score } },
    update: { mastery, lastActive: new Date(), evidence: { latestScore: score } },
  });
  res.status(201).json({ score, correct, total: quiz.questions.length, mistakes, mastery });
});

router.get("/progress", requireAuth(), async (req: any, res) => {
  const progress = await prisma.learningProgress.findMany({ where: { userId: req.user.id }, include: { subject: true }, orderBy: { mastery: "desc" } });
  const attempts = await prisma.attempt.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: 10, include: { quiz: true } });
  res.json({ progress, attempts });
});

router.post("/study-sessions", requireAuth(), async (req: any, res) => {
  const minutes = Math.max(0, Math.min(1440, Number(req.body?.minutes) || 0));
  const session = await prisma.studySession.create({ data: { userId: req.user.id, subjectId: String(req.body?.subjectId || "") || null, minutes, goal: String(req.body?.goal || "") || null, endedAt: new Date() } });
  if (session.subjectId) await prisma.learningProgress.updateMany({ where: { userId: req.user.id, subjectId: session.subjectId }, data: { studyMins: { increment: minutes }, lastActive: new Date() } });
  res.status(201).json(session);
});

router.get("/review", requireAuth(), async (req: any, res) => {
  const cards = await prisma.reviewCard.findMany({
    where: { userId: req.user.id, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" }, take: 30,
  });
  res.json(cards);
});

router.post("/review/generate", requireAuth(), async (req: any, res) => {
  const subjectId = String(req.body?.subjectId || "").trim();
  const wanted = Math.min(Math.max(Number(req.body?.count) || 12, 1), 40);
  // เดิมดึงแค่ไฟล์ล่าสุดไฟล์เดียว ซึ่งมักเป็นประกาศ -> ได้ 0 ใบเสมอ
  const pool = await prisma.material.findMany({
    where: { userId: req.user.id, ...(subjectId ? { subjectId } : {}) },
    include: { chunks: { take: 30, orderBy: { chunkIndex: "asc" } } },
  });
  // ใช้เฉพาะไฟล์ที่มีเนื้อหาจริง แล้วเรียงตามชื่อให้เป็นลำดับบท
  const materials = sortByTitle(
    pool.filter((m: any) => hasSubstantiveContent(m) && !isLinkOnly(m.textContent) && m.chunks.length),
  );
  if (!materials.length) return res.status(422).json({ error: "ยังไม่มีเอกสารที่มีเนื้อหาพอสร้างบัตรทบทวน" });

  const cards: any[] = [];
  const usedPrompts = new Set<string>();
  // หมุนเวียนไฟล์เป็นรอบ ให้ได้กระจายทุกไฟล์ ไม่กระจุกไฟล์เดียว
  const perFile: { sentence: string; words: string[]; material: any; chunk: number }[][] = materials.map((m: any) => {
    const out: any[] = [];
    for (const chunk of m.chunks) {
      for (const sentence of splitSentences(chunk.content).filter(usableSentence)) {
        const words = sentence.split(/\s+/)
          .map((w) => w.replace(/[.,!?;:()[\]{}"']/g, ""))
          .filter((w) => w.length >= 4 && /(?:\p{L}\p{M}*){3,}/u.test(w));
        if (!words.length) continue;
        out.push({ sentence, words, material: m, chunk: chunk.chunkIndex + 1 });
        if (out.length >= 4) break;
      }
      if (out.length >= 4) break;
    }
    return out;
  }).filter((x) => x.length);

  if (!perFile.length) return res.status(422).json({ error: "เนื้อหาในไฟล์สั้นเกินไปสำหรับสร้างบัตรทบทวน" });

  const used = new Array(perFile.length).fill(0);
  let guard = 0;
  while (cards.length < wanted && guard < perFile.length * 8) {
    let added = false;
    for (let i = 0; i < perFile.length && cards.length < wanted; i++) {
      const at = used[i];
      if (at >= perFile[i].length) continue;
      used[i] = at + 1;
      added = true;
      const item = perFile[i][at];
      const key = item.words[Math.floor(item.words.length / 2)];
      const prompt = "เติมคำ: " + item.sentence.replace(key, "_____");
      if (usedPrompts.has(prompt)) continue;
      usedPrompts.add(prompt);
      cards.push({
        userId: req.user.id, subjectId: item.material.subjectId,
        prompt, answer: key,
        source: { materialId: item.material.id, materialTitle: item.material.title, chunk: item.chunk },
      });
    }
    if (!added) break;
    guard++;
  }
  if (cards.length) await prisma.reviewCard.createMany({ data: cards });
  res.status(201).json({ created: cards.length, cards });
});

router.post("/review/:cardId/review", requireAuth(), async (req: any, res) => {
  const rating = Math.min(5, Math.max(0, Number(req.body?.rating) || 0));
  const card = await prisma.reviewCard.findFirst({ where: { id: req.params.cardId, userId: req.user.id } });
  if (!card) return res.status(404).json({ error: "ไม่พบบัตรทบทวน" });
  let repetitions = card.repetitions;
  let intervalDays = card.intervalDays;
  let ease = card.ease;
  let lapses = card.lapses;
  if (rating < 3) { repetitions = 0; lapses += 1; intervalDays = 1; ease = Math.max(1.3, ease - 0.2); }
  else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.max(1, Math.round(intervalDays * ease * (rating === 5 ? 1.25 : 1)));
    ease = Math.max(1.3, ease + (0.1 - (5 - rating) * 0.08));
  }
  const dueAt = new Date(Date.now() + intervalDays * 86400000);
  const updated = await prisma.reviewCard.update({ where: { id: card.id }, data: { repetitions, intervalDays, ease, lapses, dueAt, lastReviewedAt: new Date() } });
  res.json(updated);
});

router.get("/planner", requireAuth(), async (req: any, res) => {
  const tasks = await prisma.plannerTask.findMany({ where: { userId: req.user.id }, orderBy: [{ completed: "asc" }, { dueAt: "asc" }] });
  res.json(tasks);
});

router.post("/planner", requireAuth(), async (req: any, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 180);
  if (!title) return res.status(400).json({ error: "กรุณาระบุชื่องาน" });
  const dueAt = req.body?.dueAt ? new Date(req.body.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ error: "กำหนดเวลาไม่ถูกต้อง" });
  const task = await prisma.plannerTask.create({ data: {
    userId: req.user.id, subjectId: String(req.body?.subjectId || "") || null,
    title, description: String(req.body?.description || "").slice(0, 1000) || null,
    dueAt, durationMin: Math.min(600, Math.max(5, Number(req.body?.durationMin) || 30)),
  }});
  res.status(201).json(task);
});

router.patch("/planner/:taskId", requireAuth(), async (req: any, res) => {
  const task = await prisma.plannerTask.findFirst({ where: { id: req.params.taskId, userId: req.user.id } });
  if (!task) return res.status(404).json({ error: "ไม่พบงาน" });
  const updated = await prisma.plannerTask.update({ where: { id: task.id }, data: {
    completed: typeof req.body?.completed === "boolean" ? req.body.completed : task.completed,
    title: req.body?.title ? String(req.body.title).slice(0, 180) : task.title,
  }});
  res.json(updated);
});

router.get("/knowledge/:subjectId", requireAuth(), async (req: any, res) => {
  const subject = await prisma.subject.findFirst({ where: { id: req.params.subjectId, userId: req.user.id } });
  if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
  const allMaterials = await prisma.material.findMany({ where: { subjectId: subject.id, userId: req.user.id }, include: { chunks: { orderBy: { chunkIndex: "asc" }, take: 50 } } });
  // ใช้เฉพาะไฟล์ที่มีเนื้อหาจริง ไม่งั้นหัวข้อจะกลายเป็นประกาศนักศึกษาทั้งกระดาน
  const materials = sortByTitle(allMaterials.filter((m: any) => hasSubstantiveContent(m) && !isLinkOnly(m.textContent)));
  const nodes = await prisma.knowledgeNode.findMany({ where: { userId: req.user.id, subjectId: subject.id } });
  if (!nodes.length) {
    // แนวคิดหลักของวิชา = หัวข้อที่ระบบหาจากเนื้อหาจริงได้ (topics.ts)
    // ดึงจากบรรทัดสั้นใน PDF ดีกว่าแต่ได้ผลแค่บางวิชา เพราะสไลด์มักเป็นย่อหน้ายาว
    const seenConcept = new Set<string>();
    const concepts: string[] = [];
    const push = (label: string) => {
      const t = String(label || "").replace(/\s+/g, " ").trim();
      if (t.length < 3 || t.length > 70) return;
      const k = t.toLowerCase();
      if (seenConcept.has(k)) return;
      seenConcept.add(k);
      concepts.push(t);
    };
    // 1) หัวข้อย่อยที่เป็นบรรทัดสั้นในไฟล์ (กรอง page marker ออก)
    for (const material of materials) {
      for (const chunk of material.chunks) {
        for (const raw of chunk.content.split(/\n+/)) {
          if (isConceptLine(raw)) push(raw);
        }
      }
    }
    // 2) หัวข้อวิชาที่คำนวณได้ — คุณภาพดีที่สุด ใส่ตามหลัง
    try {
      const scanned = await buildSubjectTopics(req.user.id, subject.id, subject.name, false);
      for (const t of (scanned.topics || []) as any[]) push(t.label || t.title);
    } catch { /* AI ไม่ว่างก็ใช้แค่หัวข้อย่อย */ }
    // 3) ชื่อไฟล์ที่บอกเนื้อหาได้จริง
    for (const material of materials) {
      if (!contentQuality(material).enoughForQuiz) continue;
      const name = String(material.title || "");
      if (isGenericTitle(name)) continue;
      if (!isConceptLine(name)) continue;   // ชื่อที่เป็นประกาศ/แชท ไม่ใช่แนวคิด
      push(name);
    }
    const generated = concepts.slice(0, 40).map((label) => ({ userId: req.user.id, subjectId: subject.id, label, kind: "concept" }));
    if (generated.length) await prisma.knowledgeNode.createMany({ data: generated });
  }
  const finalNodes = await prisma.knowledgeNode.findMany({ where: { userId: req.user.id, subjectId: subject.id }, orderBy: { label: "asc" }, take: 80 });
  res.json({ nodes: finalNodes, edges: [] });
});

router.get("/community", requireAuth(), async (_req: any, res) => {
  const posts = await prisma.communityPost.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { id: true, name: true } }, _count: { select: { comments: true } } } });
  res.json(posts);
});

router.post("/community", requireAuth(), async (req: any, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 180);
  const content = String(req.body?.content || "").trim().slice(0, 5000);
  if (!title || !content) return res.status(400).json({ error: "กรุณาระบุหัวข้อและเนื้อหา" });
  const post = await prisma.communityPost.create({ data: { userId: req.user.id, subjectId: String(req.body?.subjectId || "") || null, title, content }, include: { user: { select: { id: true, name: true } } } });
  res.status(201).json(post);
});

router.get("/community/:postId", requireAuth(), async (req: any, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.postId }, include: { user: { select: { id: true, name: true } }, comments: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true } } } } } });
  if (!post) return res.status(404).json({ error: "ไม่พบโพสต์" });
  res.json(post);
});

router.post("/community/:postId/comments", requireAuth(), async (req: any, res) => {
  const content = String(req.body?.content || "").trim().slice(0, 3000);
  if (!content) return res.status(400).json({ error: "กรุณาระบุความคิดเห็น" });
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.postId } });
  if (!post) return res.status(404).json({ error: "ไม่พบโพสต์" });
  const comment = await prisma.communityComment.create({ data: { postId: post.id, userId: req.user.id, content }, include: { user: { select: { id: true, name: true } } } });
  res.status(201).json(comment);
});

router.get("/portal/overview", requireAuth(), async (req: any, res) => {
  if (!["ADMIN", "LECTURER"].includes(req.user.role)) return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึง Portal" });
  const [users, subjects, materials, quizzes] = await Promise.all([
    prisma.user.count(), prisma.subject.count(), prisma.material.count(), prisma.quiz.count(),
  ]);
  res.json({ users, subjects, materials, quizzes });
});

export default router;
