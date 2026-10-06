import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

// ข่าวสาร / โปรโมชั่นล่าสุด
router.get("/", requireAuth(), async (_req, res) => {
  const news = await prisma.news.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(news);
});

// เพิ่มข่าว (เฉพาะแอดมิน)
router.post("/", requireAuth("ADMIN"), async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const imageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";
  if (!title || !body) return res.status(400).json({ error: "กรุณากรอกหัวข้อและเนื้อหา" });
  const news = await prisma.news.create({
    data: { title, body, imageUrl: imageUrl || null },
  });
  res.status(201).json(news);
});

export default router;
