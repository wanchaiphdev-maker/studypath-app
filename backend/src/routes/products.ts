import { Router } from "express";
import { prisma, requireAuth } from "../auth";

const router = Router();

router.get("/", requireAuth(), async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: { name: "asc" } }));
});

type ProductBody = { name: string; price: number; pv: number; note: string | null; imageUrl: string | null };

function parseProduct(body: any): { error: string } | { data: ProductBody } {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rawPrice = body?.price;
  const rawPv = body?.pv === undefined || body?.pv === "" ? rawPrice : body.pv;
  const price = Number(rawPrice);
  const pv = Number(rawPv);
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  const imageUrl = typeof body?.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;

  if (!name) return { error: "กรุณากรอกชื่อสินค้า" };
  if (!Number.isFinite(price) || price < 0) return { error: "ราคาไม่ถูกต้อง" };
  if (!Number.isFinite(pv) || pv < 0) return { error: "PV ไม่ถูกต้อง" };
  return { data: { name, price, pv, note, imageUrl } };
}

router.post("/", requireAuth("ADMIN"), async (req, res) => {
  const parsed = parseProduct(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  res.status(201).json(await prisma.product.create({ data: parsed.data }));
});

router.put("/:id", requireAuth("ADMIN"), async (req, res) => {
  const parsed = parseProduct(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  try {
    const product = await prisma.product.update({
      where: { id: String(req.params.id) },
      data: parsed.data,
    });
    res.json(product);
  } catch {
    res.status(404).json({ error: "ไม่พบสินค้า" });
  }
});

router.delete("/:id", requireAuth("ADMIN"), async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: String(req.params.id) } });
    res.sendStatus(204);
  } catch (error: any) {
    if (error?.code === "P2003") return res.status(409).json({ error: "สินค้านี้ถูกบันทึกการขายแล้ว จึงลบไม่ได้" });
    res.status(404).json({ error: "ไม่พบสินค้า" });
  }
});

export default router;
