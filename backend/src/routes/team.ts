import { Router } from "express";
import { prisma, requireAuth } from "../auth";
import { rollup } from "../services/rollup";

const router = Router();

// รายชื่อสมาชิกที่ผู้ใช้เห็น (แอดมินเห็นทุกคน นอกนั้นเห็นเฉพาะสายงานใต้ตน)
router.get("/members", requireAuth(), async (req: any, res) => {
  const now = new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = req.query.to ? new Date(String(req.query.to)) : now;
  const range = Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to
    ? { from, to }
    : { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };

  const [users, stats] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, uplineId: true, themeColor: true, avatarUrl: true },
    }),
    rollup(range.from, range.to),
  ]);

  const children = new Map<string, string[]>();
  users.forEach(u => u.uplineId &&
    children.set(u.uplineId, [...(children.get(u.uplineId) ?? []), u.id]));

  const visible = new Set<string>();
  const walk = (id: string) => {
    if (visible.has(id)) return;
    visible.add(id);
    (children.get(id) ?? []).forEach(walk);
  };
  walk(req.user.id);
  if (req.user.role === "ADMIN") users.forEach(u => visible.add(u.id));

  const statById = new Map(stats.map(s => [s.id, s]));
  res.json(
    users
      .filter(u => visible.has(u.id))
      .map(u => {
        const s = statById.get(u.id);
        return {
          ...u,
          personal: s?.personal ?? { amount: 0, pv: 0 },
          group: s?.group ?? { amount: 0, pv: 0, downlineCount: 0 },
        };
      })
      .sort((a, b) => b.group.amount - a.group.amount || a.name.localeCompare(b.name, "th")),
  );
});

router.get("/income", requireAuth("LEADER", "ADMIN"), async (req: any, res) => {
  const now = new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = req.query.to ? new Date(String(req.query.to)) : now;

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return res.status(400).json({ error: "ช่วงวันที่ไม่ถูกต้อง" });
  }

  const member = (await rollup(from, to)).find(user => user.id === req.user.id);
  return res.json(member ?? null);
});

// สรุปทีมสำหรับหน้าหลัก
router.get("/summary", requireAuth(), async (req: any, res) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const members = await prisma.user.findMany({
    where: { id: req.user.id },
    select: { id: true },
  });
  const memberIds = members.map((m) => m.id);
  const sales = await prisma.sale.findMany({
    where: { userId: { in: memberIds }, date: { gte: from } },
    select: { totalAmount: true, totalPV: true },
  });
  res.json({
    members: memberIds.length,
    totalAmount: sales.reduce((a, s) => a + Number(s.totalAmount), 0),
    totalPV: sales.reduce((a, s) => a + Number(s.totalPV), 0),
  });
});

export default router;