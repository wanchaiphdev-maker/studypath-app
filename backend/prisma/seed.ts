import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "StudyPath Admin";

  if (!email || !email.includes("@") || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) in backend/.env");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, role: Role.ADMIN, passwordHash },
    create: { email, name, passwordHash, role: Role.ADMIN },
  });

  const year = await prisma.academicYear.upsert({
    where: { id: "seed-current-year" },
    update: { name: "ปีการศึกษา 2569", order: 1, userId: admin.id },
    create: { id: "seed-current-year", name: "ปีการศึกษา 2569", order: 1, userId: admin.id },
  });

  const semester = await prisma.semester.upsert({
    where: { id: "seed-semester-1" },
    update: { name: "ภาคการศึกษาที่ 1", order: 1, userId: admin.id, academicYearId: year.id },
    create: { id: "seed-semester-1", name: "ภาคการศึกษาที่ 1", order: 1, userId: admin.id, academicYearId: year.id },
  });

  const subjects = [
    { id: "seed-subject-programming", code: "CS101", name: "การเขียนโปรแกรมเบื้องต้น", description: "พื้นฐานการคิดเชิงคำนวณและการเขียนโปรแกรม", credits: 3, instructor: "อาจารย์ผู้สอน" },
    { id: "seed-subject-database", code: "CS202", name: "ระบบฐานข้อมูล", description: "โมเดลข้อมูล SQL และการออกแบบฐานข้อมูล", credits: 3, instructor: "อาจารย์ผู้สอน" },
  ];

  for (const item of subjects) {
    await prisma.subject.upsert({
      where: { id: item.id },
      update: { ...item, userId: admin.id, semesterId: semester.id },
      create: { ...item, userId: admin.id, semesterId: semester.id },
    });
  }

  console.log("StudyPath seed complete:", JSON.stringify({
    admin: admin.email,
    academicYear: year.name,
    semester: semester.name,
    subjects: subjects.map((s) => s.code),
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
