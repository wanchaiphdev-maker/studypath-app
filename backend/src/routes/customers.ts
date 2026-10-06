import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

// รายชื่อลูกค้าของฉัน
router.get("/", requireAuth(), async (req: any, res) => {
  const customers = await prisma.customer.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(customers);
});

// เพิ่มลูกค้า
router.post("/", requireAuth(), async (req: any, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อลูกค้า" });
  const customer = await prisma.customer.create({
    data: { name, phone: phone || null, email: email || null, note: note || null, ownerId: req.user.id },
  });
  res.status(201).json(customer);
});

// แก้ไขลูกค้า
router.patch("/:id", requireAuth(), async (req: any, res) => {
  const id = String(req.params.id);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: "ไม่พบลูกค้า" });
  const data: Record<string, string | null> = {};
  for (const key of ["name", "phone", "email", "note"] as const) {
    const value = req.body?.[key];
    if (typeof value === "string") data[key] = value.trim() || null;
  }
  if (data.name === "") return res.status(400).json({ error: "กรุณากรอกชื่อลูกค้า" });
  res.json(await prisma.customer.update({ where: { id }, data }));
});

// ลบลูกค้า
router.delete("/:id", requireAuth(), async (req: any, res) => {
  const id = String(req.params.id);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) return res.status(404).json({ error: "ไม่พบลูกค้า" });
  await prisma.customer.delete({ where: { id } });
  res.sendStatus(204);
});

export default router;
