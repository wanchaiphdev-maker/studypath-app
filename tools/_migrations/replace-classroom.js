const fs=require('fs');
const p='C:/Users/Acer/Desktop/studypath-app/backend/src/routes/classroom.ts';
let s=fs.readFileSync(p,'utf8');
const a=s.indexOf('    const suppliedMappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];');
const b=s.indexOf('    const summary = { imported:',a);
if(a<0||b<0) throw new Error('sync mapping block not found');
const block=`    const suppliedMappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    const normalize = (value: unknown) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, "");
    let userSubjects = await prisma.subject.findMany({ where: { userId: req.user.id } });
    let mappings: { courseId: string; subjectId: string }[] = suppliedMappings;
    if (!mappings.length) {
      let year = await prisma.academicYear.findFirst({ where: { userId: req.user.id }, orderBy: { order: "asc" } });
      if (!year) year = await prisma.academicYear.create({ data: { userId: req.user.id, name: "Google Classroom", order: 0 } });
      let semester = await prisma.semester.findFirst({ where: { userId: req.user.id, academicYearId: year.id }, orderBy: { order: "asc" } });
      if (!semester) semester = await prisma.semester.create({ data: { userId: req.user.id, academicYearId: year.id, name: "วิชาจาก Google Classroom", order: 0 } });
      const autoMappings: { courseId: string; subjectId: string }[] = [];
      for (const course of courses) {
        const name = String(course.name || "วิชา Google Classroom").trim().slice(0, 160);
        let subject = userSubjects.find((item) => normalize(item.name) === normalize(name));
        if (!subject) {
          subject = await prisma.subject.create({ data: { userId: req.user.id, semesterId: semester.id, name, description: String(course.description || "").slice(0, 1000) || null } });
          await prisma.learningProgress.upsert({ where: { userId_subjectId: { userId: req.user.id, subjectId: subject.id } }, create: { userId: req.user.id, subjectId: subject.id }, update: {} });
          userSubjects.push(subject);
        }
        autoMappings.push({ courseId: String(course.id), subjectId: subject.id });
      }
      mappings = autoMappings;
    }
    if (!mappings.length) return res.status(400).json({ error: "ไม่พบรายวิชาใน Google Classroom ที่สามารถซิงก์ได้" });

`;
s=s.slice(0,a)+block+s.slice(b);
fs.writeFileSync(p,s,'utf8');
console.log('Updated classroom sync mapping block');