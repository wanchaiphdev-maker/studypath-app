import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

// แจ้งเตือนของฉัน (หรือแจ้งเตือนทั่วหากไม่มี userId)
router.get("/", requireAuth(), async (req: any, res) => {
  const notifications = await prisma.notification.findMany({
    where: { OR: [{ userId: req.user.id }, { userId: null }] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications);
});

// ทำเครื่องหมายว่าอ่านแล้ว
router.post("/:id/read", requireAuth(), async (req: any, res) => {
  const id = String(req.params.id);
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "ไม่พบแจ้งเตือน" });
  res.json(await prisma.notification.update({ where: { id }, data: { read: true } }));
});

// เพิ่มแจ้งเตือน (เฉพาะแอดมิน)
router.post("/", requireAuth("ADMIN"), async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const type = typeof req.body?.type === "string" ? req.body.type.trim() : "info";
  if (!title || !body) return res.status(400).json({ error: "กรุณากรอกหัวข้อและเนื้อหา" });
  const notification = await prisma.notification.create({
    data: { title, body, type },
  });
  res.status(201).json(notification);
});

export default router;
