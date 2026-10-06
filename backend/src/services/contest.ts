import { prisma } from "../auth";
import { rollup } from "./rollup";

export type MemberStat = {
  id: string;
  name: string;
  rank: string;
  personal: { amount: number; pv: number };
  group: { amount: number; pv: number; downlineCount: number };
};

/** สร้างกระดานจัดอันดับของประกวด + อันดับของผู้ใช้ที่ระบุ
 *  หมายเหตุ: ใช้ `position` แทน `rank` เพื่อไม่ชนกับ `rank` (ระดับธุรกิจ) ของ User */
export async function leaderboard(contestId: string, myUserId?: string) {
  const c = await prisma.contest.findUniqueOrThrow({ where: { id: contestId } });
  const all = (await rollup(c.startDate, c.endDate)) as unknown as MemberStat[];

  // จัดอันดับยอดขายส่วนตัว (Top Seller)
  const byPv = [...all].sort((a, b) => b.personal.pv - a.personal.pv);
  const top = byPv
    .slice(0, 10)
    .map((u, i) => ({ ...u, position: i + 1, award: "TOP_SELLER" }));

  // Big Upline = คนที่มีสายล่าง จัดอันดับด้วย PV รวมของสายล่าง (ไม่นับยอดตัวเอง)
  const bigUpline = all
    .filter((u) => u.group.downlineCount > 0)
    .map((u) => ({ ...u, downlinePV: u.group.pv - u.personal.pv }))
    .sort((a, b) => b.downlinePV - a.downlinePV)
    .slice(0, c.bigUplineTopN)
    .map((u, i) => ({ ...u, position: i + 1, bonus: Number(c.bigUplineBonus), award: "BIG_UPLINE" }));

  // อันดับของฉัน (นับเต็มทุกคน ไม่จำกัด top 10)
  let myRank: number | null = null;
  let myPV = 0;
  let myGroupRank: number | null = null;
  if (myUserId) {
    const idx = byPv.findIndex((u) => u.id === myUserId);
    myRank = idx >= 0 ? idx + 1 : null;
    myPV = idx >= 0 ? byPv[idx].personal.pv : 0;

    const byGroup = [...all].sort((a, b) => b.group.pv - a.group.pv);
    const gIdx = byGroup.findIndex((u) => u.id === myUserId);
    myGroupRank = gIdx >= 0 ? gIdx + 1 : null;
  }

  return {
    contest: c,
    top,
    bigUpline,
    total: all.length,
    myRank,
    myPV,
    myGroupRank,
  };
}