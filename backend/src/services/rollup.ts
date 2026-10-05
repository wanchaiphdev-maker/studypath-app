import { prisma } from "../auth";

// รวมยอดส่วนตัวของทุกคนในช่วงเวลา แล้วไล่รวมขึ้นไปตามสาย upline
export async function rollup(from: Date, to: Date) {
  const [users, sales] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, uplineId: true } }),
    prisma.sale.groupBy({ by: ["userId"], where: { date: { gte: from, lt: to } },
      _sum: { totalAmount: true, totalPV: true } }) ]);

  const personal = new Map(sales.map(s => [s.userId,
    { amount: Number(s._sum.totalAmount ?? 0), pv: Number(s._sum.totalPV ?? 0) }]));
  const children = new Map<string, string[]>();
  users.forEach(u => u.uplineId &&
    children.set(u.uplineId, [...(children.get(u.uplineId) ?? []), u.id]));

  const memo = new Map<string, { amount: number; pv: number; downlineCount: number }>();
  const calc = (id: string): { amount: number; pv: number; downlineCount: number } => {
    if (memo.has(id)) return memo.get(id)!;
    const self = personal.get(id) ?? { amount: 0, pv: 0 };
    let t = { amount: self.amount, pv: self.pv, downlineCount: 0 };
    for (const c of children.get(id) ?? []) {
      const d = calc(c);
      t.amount += d.amount; t.pv += d.pv; t.downlineCount += d.downlineCount + 1;
    }
    memo.set(id, t); return t;
  };
  return users.map(u => ({ id: u.id, name: u.name, personal: personal.get(u.id) ?? { amount: 0, pv: 0 }, group: calc(u.id) }));
}