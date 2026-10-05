import { prisma } from "../auth";
import { rollup } from "./rollup";

export async function leaderboard(contestId: string) {
  const c = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  const all = await rollup(c.startDate, c.endDate);

  const top = [...all].sort((a, b) => b.personal.pv - a.personal.pv)
    .slice(0, 10).map((u, i) => ({ rank: i + 1, ...u, award: "TOP_SELLER" }));

  // Big Upline = เฉพาะคนที่มี downline, จัดอันดับด้วย PV รวมของ "สายล่าง" (ไม่นับยอดตัวเอง)
  const bigUpline = all
    .filter(u => u.group.downlineCount > 0)
    .map(u => ({ ...u, downlinePV: u.group.pv - u.personal.pv }))
    .sort((a, b) => b.downlinePV - a.downlinePV)
    .slice(0, c.bigUplineTopN)
    .map((u, i) => ({ rank: i + 1, ...u, bonus: c.bigUplineBonus, award: "BIG_UPLINE" }));

  return { contest: c, top, bigUpline };
}