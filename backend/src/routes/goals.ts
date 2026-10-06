import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

// เป้าหมายของฉัน
router.get("/", requireAuth(), async (req: any, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(goals);
});

// เพิ่มเป้าหมาย
router.post("/", requireAuth(), async (req: any, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const target = Number(req.body?.target);
  const period = req.body?.period === "yearly" ? "yearly" : "monthly";
  if (!title) return res.status(400).json({ error: "กรุณากรอกชื่อเป้าหมาย" });
  if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: "เป้าหมายไม่ถูกต้อง" });
  const goal = await prisma.goal.create({
    data: { title, target, period, userId: req.user.id },
  });
  res.status(201).json(goal);
});

// อัปเดตค่าปัจจุบันของเป้าหมาย
router.patch("/:id", requireAuth(), async (req: any, res) => {
  const id = String(req.params.id);
  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: "ไม่พบเป้าหมาย" });
  const data: Record<string, any> = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) data.title = req.body.title.trim();
  if (req.body?.target !== undefined) {
    const target = Number(req.body.target);
    if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: "เป้าหมายไม่ถูกต้อง" });
    data.target = target;
  }
  if (req.body?.current !== undefined) {
    const current = Number(req.body.current);
    if (!Number.isFinite(current) || current < 0) return res.status(400).json({ error: "ค่าปัจจุบันไม่ถูกต้อง" });
    data.current = current;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: "ไม่มีข้อมูลที่จะแก้" });
  res.json(await prisma.goal.update({ where: { id }, data }));
});

// ลบเป้าหมาย
router.delete("/:id", requireAuth(), async (req: any, res) => {
  const id = String(req.params.id);
  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: "ไม่พบเป้าหมาย" });
  await prisma.goal.delete({ where: { id } });
  res.sendStatus(204);
});

export default router;
