import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

// กิจกรรมที่กำลังจะมาถึง
router.get("/", requireAuth(), async (_req, res) => {
  const events = await prisma.event.findMany({
    where: { startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  res.json(events);
});

// เพิ่มกิจกรรม (เฉพาะแอดมิน)
router.post("/", requireAuth("ADMIN"), async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const location = typeof req.body?.location === "string" ? req.body.location.trim() : "";
  const startsAt = new Date(String(req.body?.startsAt ?? ""));
  if (!title || !Number.isFinite(startsAt.getTime())) {
    return res.status(400).json({ error: "กรุณากรอกหัวข้อและวันที่จัดกิจกรรม" });
  }
  const event = await prisma.event.create({
    data: { title, description: description || null, location: location || null, startsAt },
  });
  res.status(201).json(event);
});

export default router;
