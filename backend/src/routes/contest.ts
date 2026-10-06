import { Router } from "express";
import { prisma, requireAuth } from "../auth";
import { leaderboard } from "../services/contest";

const router = Router();

const dateOf = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));

/** สถานะประกวด: กำลังเข้าร่วม / กำลังมา / จบแล้ว */
function statusOf(startDate: Date, endDate: Date) {
  const now = Date.now();
  if (now < startDate.getTime()) return "UPCOMING";
  if (now > endDate.getTime()) return "ENDED";
  return "ACTIVE";
}

/** รายการประกวดทั้งหมด (ที่เห็นตามกลุ่มของผู้ใช้) + สถานะปัจจุบัน */
router.get("/", requireAuth(), async (req: any, res) => {
  const contests = await prisma.contest.findMany({
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      groupId: true,
      bigUplineTopN: true,
      bigUplineBonus: true,
    },
  });

  // ADMIN เห็นทั้งหมด, สมาชิกทั่วไปเห็นเฉพาะประกวดของกลุ่มตัวเองหรือประกวดสาธารณะ
  const visible = contests.filter(
    (c) => req.user.role === "ADMIN" || !c.groupId || c.groupId === req.user.groupId,
  );

  res.json(
    visible.map((c) => ({
      ...c,
      bigUplineBonus: Number(c.bigUplineBonus),
      status: statusOf(c.startDate, c.endDate),
    })),
  );
});

/** สร้างประกวดใหม่ (หัวหน้าทีม/แอดมิน) */
router.post("/", requireAuth("LEADER", "ADMIN"), async (req: any, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const startDate = dateOf(req.body?.startDate);
  const endDate = dateOf(req.body?.endDate);
  const topN = Number(req.body?.bigUplineTopN ?? 3);
  const bonus = Number(req.body?.bigUplineBonus ?? 0);
  const groupId = typeof req.body?.groupId === "string" ? req.body.groupId : null;

  if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อประกวด" });
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return res.status(400).json({ error: "วันที่ไม่ถูกต้อง" });
  }
  if (startDate >= endDate) return res.status(400).json({ error: "วันสิ้นสุดต้องมากกว่าวันเริ่ม" });
  if (!Number.isFinite(topN) || topN < 1 || topN > 20) {
    return res.status(400).json({ error: "จำนวนรางวัล Big Upline ต้องอยู่ระหว่าง 1-20" });
  }
  if (!Number.isFinite(bonus) || bonus < 0) return res.status(400).json({ error: "เงินรางวัลไม่ถูกต้อง" });

  // หัวหน้าทีมสร้างได้เฉพาะกลุ่มของตัวเอง
  const finalGroupId = req.user.role === "ADMIN" ? groupId : req.user.groupId ?? null;

  const contest = await prisma.contest.create({
    data: {
      name,
      startDate,
      endDate,
      groupId: finalGroupId,
      bigUplineTopN: Math.floor(topN),
      bigUplineBonus: bonus,
    },
  });
  res.status(201).json({ ...contest, bigUplineBonus: Number(contest.bigUplineBonus), status: "UPCOMING" });
});

/** ลบประกวด */
router.delete("/:id", requireAuth("LEADER", "ADMIN"), async (req: any, res) => {
  const id = String(req.params.id);
  const existing = await prisma.contest.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "ไม่พบประกวด" });
  if (req.user.role !== "ADMIN" && existing.groupId !== req.user.groupId) {
    return res.sendStatus(403);
  }
  await prisma.contest.delete({ where: { id } });
  res.sendStatus(204);
});

/** กระดานจัดอันดับของประกวด + อันดับของฉัน */
router.get("/:id/leaderboard", requireAuth(), async (req: any, res) => {
  const contest = await prisma.contest.findUnique({ where: { id: String(req.params.id) } });
  if (!contest) return res.status(404).json({ error: "ไม่พบประกวด" });
  if (req.user.role !== "ADMIN" && contest.groupId && contest.groupId !== req.user.groupId) {
    return res.sendStatus(403);
  }

  const result = await leaderboard(String(req.params.id), String(req.user.id));

  return res.json({
    contest: {
      ...result.contest,
      bigUplineBonus: Number(result.contest.bigUplineBonus),
      status: statusOf(result.contest.startDate, result.contest.endDate),
    },
    top: result.top,
    bigUpline: result.bigUpline.map((u: any) => ({ ...u, bonus: Number(u.bonus) })),
    total: result.total,
    myRank: result.myRank,
    myPV: result.myPV,
    myGroupRank: result.myGroupRank,
  });
});

export default router;