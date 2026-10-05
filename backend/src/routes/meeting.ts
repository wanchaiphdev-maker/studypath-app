import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

router.get("/", requireAuth(), async (req: any, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { groupId: true },
  });
  const where = req.user.role === "ADMIN"
    ? {}
    : user?.groupId
      ? { OR: [{ hostId: req.user.id }, { groupId: user.groupId }] }
      : { hostId: req.user.id };
  const meetings = await prisma.meeting.findMany({
    where,
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  return res.json(meetings);
});

router.post("/", requireAuth("LEADER", "ADMIN"), async (req: any, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const startsAt = new Date(String(req.body.startsAt ?? ""));
  if (!title || !Number.isFinite(startsAt.getTime())) {
    return res.status(400).json({ error: "กรุณาระบุชื่อและเวลาเริ่มประชุมให้ถูกต้อง" });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { groupId: true },
  });
  const requestedGroupId = req.body.groupId ? String(req.body.groupId) : null;
  if (req.user.role !== "ADMIN" && requestedGroupId && requestedGroupId !== user?.groupId) {
    return res.sendStatus(403);
  }

  const meeting = await prisma.meeting.create({
    data: {
      title,
      startsAt,
      hostId: req.user.id,
      groupId: req.user.role === "ADMIN" ? requestedGroupId : user?.groupId ?? null,
    },
  });
  return res.status(201).json(meeting);
});

export default router;
