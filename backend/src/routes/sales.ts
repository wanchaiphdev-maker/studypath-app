import { Router } from "express";
import { prisma, requireAuth } from "../auth";
const r = Router();

r.post("/", requireAuth(), async (req: any, res) => {
  const { items, date } = req.body; // items: [{productId, qty}]
  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i: any) => i.productId) } } });
  const map = new Map(products.map(p => [p.id, p]));
  let amount = 0, pv = 0;
  const rows = items.map((i: any) => {
    const p = map.get(i.productId)!;
    amount += Number(p.price) * i.qty; pv += Number(p.pv) * i.qty;
    return { productId: p.id, qty: i.qty, unitPrice: p.price, unitPV: p.pv };
  });
  const sale = await prisma.sale.create({
    data: { userId: req.user.id, date: date ? new Date(date) : new Date(),
            totalAmount: amount, totalPV: pv, items: { create: rows } } });
  res.json(sale);
});

// สรุปรายวัน/เดือน + รายได้สะสม: ?by=day|month
r.get("/summary", requireAuth(), async (req: any, res) => {
  const by = req.query.by === "day" ? "day" : "month";
  const data = await prisma.$queryRawUnsafe(`
    SELECT date_trunc('${by}', date) AS period,
           SUM("totalAmount") AS amount, SUM("totalPV") AS pv
    FROM "Sale" WHERE "userId" = $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, req.user.id);
  res.json(data);
});

r.get("/history", requireAuth(), async (req: any, res) =>
  res.json(await prisma.sale.findMany({
    where: { userId: req.user.id }, include: { items: { include: { product: true } } },
    orderBy: { date: "desc" }, take: 100 })));

// การขายล่าสุด (สำหรับหน้าหลัก)
r.get("/recent", requireAuth(), async (req: any, res) => {
  const sales = await prisma.sale.findMany({
    where: { userId: req.user.id },
    orderBy: { date: "desc" },
    take: 10,
    include: { items: { select: { qty: true } } },
  });
  res.json(sales.map((s) => ({
    id: s.id,
    date: s.date.toISOString(),
    totalAmount: Number(s.totalAmount),
    totalPV: Number(s.totalPV),
    itemCount: s.items.reduce((a: number, i: any) => a + i.qty, 0),
  })));
});
export default r;