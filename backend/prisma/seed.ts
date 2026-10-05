import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role, RoomType } from "@prisma/client";

const prisma = new PrismaClient();

// รหัสผ่านของบัญชีทดสอบ (แก้ได้ผ่าน env SEED_PASSWORD)
export const DEMO_PASSWORD = process.env.SEED_PASSWORD || "AmwayDemo2026!";

const PRODUCTS = [
  { name: "Nutrilite Daily Multivitamin", price: 1200, pv: 90 },
  { name: "Nutrilite Vitamin C 1000mg", price: 690, pv: 52 },
  { name: "Artistry Ideal Radiance Essence", price: 2450, pv: 184 },
  { name: "Artistry Hydra-V Gel Cream", price: 1150, pv: 86 },
  { name: "LOC Multi-Purpose Cleaner", price: 320, pv: 24 },
  { name: "SA8 Premium Liquid Detergent", price: 560, pv: 42 },
  { name: "XS Energy Drink Citrus", price: 540, pv: 40 },
];

async function upsertUser(email: string, name: string, role: Role, uplineId: string | null, groupId: string | null, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name, role, uplineId, groupId },
    create: { email, name, role, uplineId, groupId, passwordHash },
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Admin";

  if (!email || !email.includes("@") || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in backend/.env");
  }

  const adminHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, role: Role.ADMIN },
    create: { email, name, passwordHash: adminHash, role: Role.ADMIN },
  });

  // กลุ่มหลัก (มีแค่กลุ่มเดียวในเดโม)
  const group = (await prisma.group.findFirst({ where: { name: "กลุ่มหลัก" } }))
    ?? await prisma.group.create({ data: { name: "กลุ่มหลัก" } });
  await prisma.group.update({ where: { id: group.id }, data: { members: { connect: { id: admin.id } } } });

  // บัญชีทดสอบ: หัวหน้าทีม + สมาชิก 2 คน (ใช้ทดสอบหน้าทีม/แชท)
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const leader = await upsertUser("leader@amway.local", "สมชาย หัวหน้าทีม", Role.LEADER, admin.id, group.id, demoHash);
  const member1 = await upsertUser("member1@amway.local", "สมหญิง สมาชิก", Role.MEMBER, leader.id, group.id, demoHash);
  const member2 = await upsertUser("member2@amway.local", "สมศักดิ์ สมาชิก", Role.MEMBER, leader.id, group.id, demoHash);
  await prisma.group.update({
    where: { id: group.id },
    data: { members: { connect: [{ id: leader.id }, { id: member1.id }, { id: member2.id }] } },
  });

  // สินค้า
  for (const product of PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (existing) await prisma.product.update({ where: { id: existing.id }, data: product });
    else await prisma.product.create({ data: product });
  }

  // ห้องแชทกลุ่ม
  let groupRoom = await prisma.room.findFirst({ where: { type: RoomType.GROUP, groupId: group.id } });
  if (!groupRoom) groupRoom = await prisma.room.create({ data: { type: RoomType.GROUP, groupId: group.id, members: [] } });

  // ห้องคุยตรง แอดมิน <-> หัวหน้าทีม
  let directRoom = await prisma.room.findFirst({
    where: { type: RoomType.DIRECT, AND: [{ members: { has: admin.id } }, { members: { has: leader.id } }] },
  });
  if (!directRoom) {
    directRoom = await prisma.room.create({ data: { type: RoomType.DIRECT, members: [admin.id, leader.id] } });
  }

  // ข้อความตัวอย่าง (รันซ้ำได้โดยไม่ทับของเดิม)
  const demoMessages: Array<{ roomId: string; senderId: string; text: string; minutesAgo: number }> = [
    { roomId: groupRoom.id, senderId: admin.id, text: "สวัสดีทุกคน ยอดเดือนนี้ทำได้ดีมากครับ 👏", minutesAgo: 180 },
    { roomId: groupRoom.id, senderId: leader.id, text: "ขอบคุณครับ สัปดาห์หน้าจะนัดประชุมทีม", minutesAgo: 120 },
    { roomId: groupRoom.id, senderId: member1.id, text: "รับทราบค่ะ แล้วเจอกันในห้องประชุม", minutesAgo: 45 },
    { roomId: directRoom.id, senderId: leader.id, text: "พี่ครับ ขอตัวเลขยอด PV ของทีมหน่อยครับ", minutesAgo: 60 },
    { roomId: directRoom.id, senderId: admin.id, text: "ส่งให้ทางหน้าทีมแล้วนะครับ", minutesAgo: 30 },
  ];
  for (const message of demoMessages) {
    const duplicate = await prisma.message.findFirst({
      where: { roomId: message.roomId, senderId: message.senderId, text: message.text },
    });
    if (duplicate) continue;
    await prisma.message.create({
      data: {
        roomId: message.roomId,
        senderId: message.senderId,
        text: message.text,
        createdAt: new Date(Date.now() - message.minutesAgo * 60_000),
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    products: await prisma.product.count(),
    rooms: await prisma.room.count(),
    messages: await prisma.message.count(),
    groups: await prisma.group.count(),
  };
  console.log("seed complete:", JSON.stringify(counts));
  console.log("บัญชีทดสอบ (รหัสเดียวกันทุกคน):", DEMO_PASSWORD);
  console.log("  admin   ", email);
  console.log("  leader  ", "leader@amway.local");
  console.log("  member1 ", "member1@amway.local");
  console.log("  member2 ", "member2@amway.local");
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
