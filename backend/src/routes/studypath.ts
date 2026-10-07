import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { prisma, requireAuth } from "../auth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "text/plain"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router = Router();

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
    include: { semester: { include: { academicYear: true } }, materials: { orderBy: { createdAt: "desc" } }, progress: true },
  });
  if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
  res.json(subject);
});

router.post("/materials/upload", requireAuth(), upload.single("file"), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const title = String(req.body?.title || req.file?.originalname || "เอกสารการเรียน").trim().slice(0, 200);
    if (!subjectId) return res.status(400).json({ error: "กรุณาระบุวิชา" });
    if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์ PDF หรือ TXT" });

    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    let textContent = "";
    let pageCount: number | undefined;
    if (req.file.mimetype === "application/pdf") {
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      textContent = String(result.text || "").trim();
      pageCount = Number(result.total || 0) || undefined;
      await parser.destroy();
    } else {
      textContent = req.file.buffer.toString("utf8").trim();
    }

    if (textContent.length < 20) {
      return res.status(422).json({ error: "ไฟล์นี้ไม่มีข้อความที่อ่านได้เพียงพอ หากเป็น PDF สแกนภาพจะต้องใช้ OCR เพิ่มเติม" });
    }

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
        title,
        fileName: req.file.originalname.slice(0, 255),
        mimeType: req.file.mimetype,
        sourceType: "IMPORTED",
        status: "COMPLETED",
        textContent,
        pageCount,
        userId: req.user.id,
        subjectId,
        chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) },
      },
      include: { chunks: true },
    });
    await prisma.subject.update({ where: { id: subjectId }, data: { status: "IN_PROGRESS" } });
    res.status(201).json({
      id: material.id, title: material.title, fileName: material.fileName,
      status: material.status, pageCount: material.pageCount, chunkCount: material.chunks.length,
    });
  } catch (error) {
    console.error("StudyPath material upload failed", error);
    res.status(500).json({ error: "ประมวลผลเอกสารไม่สำเร็จ" });
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
      title, sourceType: "IMPORTED", status: "COMPLETED", textContent,
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
  const material = await prisma.material.findFirst({ where: { id: req.params.materialId, userId: req.user.id }, include: { chunks: true } });
  if (!material) return res.status(404).json({ error: "ไม่พบเอกสาร" });
  const q = new Set(question.toLowerCase().split(/\s+/).filter((x: string) => x.length > 1));
  const ranked = material.chunks.map((chunk) => {
    const words = chunk.content.toLowerCase().split(/\s+/);
    const score = words.reduce((n: number, word: string) => n + (q.has(word.replace(/[^\p{L}\p{N}]/gu, "")) ? 1 : 0), 0);
    return { chunk, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!ranked.length) return res.json({ grounded: false, answer: "ยังไม่พบข้อมูลที่ตรงกับคำถามในเอกสารนี้", sources: [] });
  res.json({
    grounded: true, mode: "grounded-retrieval",
    answer: ranked.map((x) => x.chunk.content).join("\n\n"),
    sources: ranked.map((x) => ({ materialId: material.id, title: material.title, chunk: x.chunk.chunkIndex + 1, excerpt: x.chunk.content.slice(0, 220) })),
  });
});

router.post("/subjects/:subjectId/quizzes/generate", requireAuth(), async (req: any, res) => {
  const subject = await prisma.subject.findFirst({ where: { id: req.params.subjectId, userId: req.user.id }, include: { materials: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
  if (!subject.materials.length) return res.status(422).json({ error: "กรุณาเพิ่มเอกสารก่อนสร้าง Quiz" });
  const source = subject.materials[0];
  const sentences = source.textContent.split(/(?<=[.!?。！？])\s+|\n+/).map((x: string) => x.trim()).filter((x: string) => x.length >= 30).slice(0, 10);
  if (!sentences.length) return res.status(422).json({ error: "เนื้อหายังสั้นเกินไปสำหรับสร้าง Quiz" });
  const count = Math.min(Math.max(Number(req.body?.count) || 5, 1), sentences.length);
  const questions = sentences.slice(0, count).map((sentence: string, index: number) => {
    const words = sentence.split(/\s+/).filter((w: string) => w.length >= 4);
    const answer = (words[Math.floor(words.length / 2)] || words[0] || "คำตอบ").replace(/[.,!?;:()[\]{}]/g, "");
    const prompt = sentence.replace(answer, "_____");
    return {
      type: "MULTIPLE_CHOICE" as const,
      prompt: "เติมข้อความจากเอกสาร: " + prompt,
      options: [answer, "ไม่มีข้อมูล", "ไม่เกี่ยวข้อง", "ข้อมูลไม่เพียงพอ"],
      answer, explanation: "อ้างอิงจาก " + source.title,
      source: { materialId: source.id, materialTitle: source.title, chunk: index + 1 }, order: index,
    };
  });
  const quiz = await prisma.quiz.create({
    data: { title: "ฝึกทำความเข้าใจ: " + subject.name, subjectId: subject.id, userId: req.user.id, questions: { create: questions } },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  res.status(201).json(quiz);
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

export default router;
