import { Router } from "express";
import { prisma, requireAuth } from "../auth";
import { canAccessRoom } from "../services/access";

const router = Router();

const messageSelect = {
  id: true,
  roomId: true,
  senderId: true,
  text: true,
  createdAt: true,
  sender: { select: { id: true, name: true, themeColor: true } },
} as const;

const roomSelect = {
  id: true,
  type: true,
  groupId: true,
  members: true,
  group: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 1, select: messageSelect },
} as const;

type RoomSelectResult = {
  id: string;
  type: string;
  groupId: string | null;
  members: string[];
  group: { id: string; name: string } | null;
  messages: Array<{ createdAt: Date }>;
};

// ห้องที่ผู้ใช้เข้าถึงได้ (แอดมินเห็นทั้งหมด เรียงตามข้อความล่าสุด)
router.get("/rooms", requireAuth(), async (req: any, res) => {
  const where = req.user.role === "ADMIN"
    ? {}
    : {
        OR: [
          { members: { has: req.user.id } },
          { group: { members: { some: { id: req.user.id } } } },
        ],
      };

  const rooms = await prisma.room.findMany({ where, select: roomSelect });
  const withLast = (rooms as RoomSelectResult[])
    .map(({ messages, ...room }) => ({ ...room, lastMessage: messages[0] ?? null }))
    .sort((a, b) => {
      const at = a.lastMessage ? new Date((a.lastMessage as { createdAt: Date }).createdAt).getTime() : 0;
      const bt = b.lastMessage ? new Date((b.lastMessage as { createdAt: Date }).createdAt).getTime() : 0;
      return bt - at;
    });

  // ชื่อสมาชิกในห้อง (สำหรับแสดงผลฝั่งแอป)
  const ids = [...new Set(withLast.flatMap(r => r.members))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, themeColor: true },
      })
    : [];
  const info = new Map(users.map(u => [u.id, u]));

  res.json(withLast.map(room => ({
    ...room,
    membersInfo: room.members.map(id => info.get(id) ?? { id, name: "ผู้ใช้", themeColor: "#2563eb" }),
  })));
});

// ประวัติข้อความ (ใหม่สุด 50 รายการ เรียงเก่า -> ใหม่)
router.get("/rooms/:id/messages", requireAuth(), async (req: any, res) => {
  const roomId = String(req.params.id);
  if (!(await canAccessRoom(req.user.id, req.user.role, roomId))) return res.sendStatus(403);

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const messages = await prisma.message.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: messageSelect,
  });
  res.json(messages.reverse());
});

// สร้างห้อง: คุยตรง (DIRECT) หรือห้องกลุ่ม (GROUP) — สร้างซ้ำจะคืนห้องเดิม
router.post("/rooms", requireAuth(), async (req: any, res) => {
  const type = String(req.body?.type || "").toUpperCase();
  const requestedGroup = req.body?.groupId ? String(req.body.groupId) : null;

  if (type === "DIRECT") {
    const otherId = req.body?.userId ? String(req.body.userId) : "";
    if (!otherId || otherId === req.user.id) {
      return res.status(400).json({ error: "เลือกสมาชิกที่ต้องการคุยด้วย" });
    }
    const other = await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } });
    if (!other) return res.status(404).json({ error: "ไม่พบสมาชิกคนนี้" });

    const existing = await prisma.room.findFirst({
      where: { type: "DIRECT", AND: [{ members: { has: req.user.id } }, { members: { has: otherId } }] },
      select: roomSelect,
    });
    if (existing) {
      const { messages, ...room } = existing as RoomSelectResult;
      return res.json({ ...room, lastMessage: messages[0] ?? null });
    }

    const created = await prisma.room.create({
      data: { type: "DIRECT", members: [req.user.id, otherId] },
      select: roomSelect,
    });
    const { messages, ...room } = created as RoomSelectResult;
    return res.status(201).json({ ...room, lastMessage: null });
  }

  if (type === "GROUP" && requestedGroup) {
    const group = await prisma.group.findUnique({
      where: { id: requestedGroup },
      select: { id: true, members: { select: { id: true } } },
    });
    if (!group) return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    const isMember = group.members.some(m => m.id === req.user.id);
    if (req.user.role !== "ADMIN" && !isMember) return res.sendStatus(403);

    const existing = await prisma.room.findFirst({
      where: { type: "GROUP", groupId: requestedGroup },
      select: roomSelect,
    });
    if (existing) {
      const { messages, ...room } = existing as RoomSelectResult;
      return res.json({ ...room, lastMessage: messages[0] ?? null });
    }

    const created = await prisma.room.create({
      data: { type: "GROUP", groupId: requestedGroup, members: [] },
      select: roomSelect,
    });
    const { messages, ...room } = created as RoomSelectResult;
    return res.status(201).json({ ...room, lastMessage: null });
  }

  return res.status(400).json({ error: "ระบุ type เป็น DIRECT หรือ GROUP" });
});

export default router;
