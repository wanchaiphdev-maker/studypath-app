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
  const sources = ranked.map((x) => ({ materialId: material.id, title: material.title, chunk: x.chunk.chunkIndex + 1, excerpt: x.chunk.content.slice(0, 220) }));
  const context = ranked.map((x) => "[Source " + (x.chunk.chunkIndex + 1) + "] " + x.chunk.content).join("\n\n");
  let answer = ranked.map((x) => x.chunk.content).join("\n\n");
  let mode = "grounded-retrieval";
  try {
    const modelAnswer = await groundedModelAnswer(question, context);
    if (modelAnswer) { answer = modelAnswer; mode = "grounded-llm"; }
  } catch (error) {
    console.warn("AI provider unavailable; using grounded retrieval fallback", error);
  }
  res.json({ grounded: true, mode, answer, sources });
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

router.get("/review", requireAuth(), async (req: any, res) => {
  const cards = await prisma.reviewCard.findMany({
    where: { userId: req.user.id, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" }, take: 30,
  });
  res.json(cards);
});

router.post("/review/generate", requireAuth(), async (req: any, res) => {
  const subjectId = String(req.body?.subjectId || "").trim();
  const material = await prisma.material.findFirst({
    where: { userId: req.user.id, ...(subjectId ? { subjectId } : {}) },
    orderBy: { createdAt: "desc" }, include: { chunks: { take: 20, orderBy: { chunkIndex: "asc" } } },
  });
  if (!material) return res.status(404).json({ error: "ยังไม่มีเอกสารสำหรับสร้างบัตรทบทวน" });
  const cards = [];
  for (const chunk of material.chunks.slice(0, 10)) {
    const first = chunk.content.split(/[.!?。！？\n]/).map((x: string) => x.trim()).filter(Boolean)[0];
    if (!first || first.length < 20) continue;
    const words = first.split(/\s+/).filter((x: string) => x.length >= 4);
    const key = words[Math.floor(words.length / 2)] || words[0];
    cards.push({
      userId: req.user.id, subjectId: material.subjectId,
      prompt: "อธิบายหรือเติมคำจากแนวคิดนี้: " + first.replace(key, "_____"),
      answer: key, source: { materialId: material.id, chunk: chunk.chunkIndex + 1 },
    });
  }
  if (cards.length) await prisma.reviewCard.createMany({ data: cards });
  res.status(201).json({ created: cards.length });
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
  const materials = await prisma.material.findMany({ where: { subjectId: subject.id, userId: req.user.id }, include: { chunks: { orderBy: { chunkIndex: "asc" }, take: 50 } } });
  const nodes = await prisma.knowledgeNode.findMany({ where: { userId: req.user.id, subjectId: subject.id } });
  if (!nodes.length) {
    const labels = new Set<string>();
    for (const material of materials) for (const chunk of material.chunks) {
      for (const word of chunk.content.split(/\s+/).filter((x: string) => x.length >= 5).slice(0, 60)) labels.add(word.replace(/[^\p{L}\p{N}-]/gu, ""));
    }
    const generated = Array.from(labels).filter(Boolean).slice(0, 40).map(label => ({ userId: req.user.id, subjectId: subject.id, label, kind: "concept" }));
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
  if (!["ADMIN", "LEADER"].includes(req.user.role)) return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึง Portal" });
  const [users, subjects, materials, quizzes] = await Promise.all([
    prisma.user.count(), prisma.subject.count(), prisma.material.count(), prisma.quiz.count(),
  ]);
  res.json({ users, subjects, materials, quizzes });
});

export default router;
