import { Router } from "express";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { PDFParse } from "pdf-parse";
import { prisma, requireAuth } from "../auth";
import { getGoogleAccessToken } from "./google";
import { getAutosyncState, runAutosyncOnce } from "../autosync";
import { syncSubmissionsForCourse } from "./submissions";
import { classroomJson, listAllPages, CLASSROOM_API } from "./classroom-api";
import { driveFileMeta, downloadDriveFile } from "./classroom-files";

const router = Router();
const CLASSROOM = "https://classroom.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com/drive/v3";

// กฎกรองทั้งหมดแยกไว้ที่ filters/classroom-filters.ts เพื่อให้สคริปต์ล้างข้อมูลเก่า
// ใช้ชุดเดียวกันนี้ (คนละชุด = คลาดกันเงียบๆ)
import {
  isNoisePost, isStudyContent, isOffTopicFile, displayTitle, isUnusableImage,
  OFFICIAL_DOC_RE, LOGISTICS_FILE_RE, hasSubstantiveContent,
} from "../filters/classroom-filters";
import { categorize } from "../filters/classroom-category";

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), "storage", "materials"));
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function chunkText(text: string) {
  const parts = text.split(/(?<=[.!?。！？])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if ((current + " " + part).trim().length > 1200 && current) {
      chunks.push(current.trim());
      current = part;
    } else current = (current + " " + part).trim();
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
/**
 * ประตูตัวกรองเดียวสำหรับ "จะเก็บรายการนี้ไว้ไหม"
 *
 * ผู้ใช้กำหนดชัดเจนว่าเก็บแค่ 6 หมวด:
 *   โบนัส · งานในห้อง · การบ้าน · เช็คชื่อ · VDO · สไลด์
 *   "อย่างอื่นไม่ต้องเอาเข้ามา"
 * กฎการแยกหมวดอยู่ที่ filters/classroom-category.ts
 */
function shouldKeepItem(externalId: string, title: string, fileName: string | null, textContent: string, mimeType?: string | null) {
  if (!categorize(externalId, title, mimeType)) return false;
  return isStudyContent(title + " " + (fileName || "") + " " + String(textContent || ""));
}

/** รวมทุกหน้าของ endpoint ที่คืนรายการแบบเดียวกัน
 *  หมายเหตุ: Classroom API คืน "courseWorkMaterial" (เอกพจพานย์) ไม่ใช่ "courseWorkMaterials" */
async function listAll(url: string, accessToken: string): Promise<any[]> {
  return listAllPages(url, accessToken, ["courses", "courseWorkMaterial", "courseWork", "announcements"]);
}

function materialId(courseId: string, itemType: string, itemId: string, driveId: string) {
  return ["classroom", courseId, itemType, itemId, driveId].join(":");
}

router.get("/status", requireAuth(), async (req: any, res) => {
  const connection = await prisma.googleConnection.findUnique({ where: { userId: req.user.id }, select: { connectedAt: true, updatedAt: true, expiresAt: true, scope: true } });
  res.json({ connected: !!connection, connectedAt: connection?.connectedAt || null, updatedAt: connection?.updatedAt || null, expiresAt: connection?.expiresAt || null, scope: connection?.scope || null, autosync: getAutosyncState() });
});

// สั่งซิงก์ทันที (ผู้ดูแลระบบเท่านั้น)
router.post("/autosync", requireAuth(), async (req: any, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "เฉพาะผู้ดูแลระบบเท่านั้น" });
  res.json(await runAutosyncOnce("manual"));
});

/**
 * ข้ามการเขียนซ้ำถ้าเนื้อหาไม่เปลี่ยนจริง
 *
 * ปัญหาเดิม: รายการที่เป็น "ลิงก์/สื่อ" (mime = text/uri-list) ไม่มีไฟล์ให้เทียบ
 * ทำให้ทุกรอบซิงก์เขียนทับทุกแถวใหม่ 145 แถวทุก 5 นาที (ลบ chunk + สร้างใหม่ทั้งชุด)
 */
async function writeMaterialIfChanged(
  req: any,
  externalId: string,
  subjectId: string,
  data: any,
  textContent: string,
  summary: { imported: number; updated: number; skipped: number },
): Promise<void> {
  // ไฟล์ที่ผู้ใช้สั่งลบแล้ว — ข้ามทันที ไม่สร้าง/อัปเดต Material ให้กลับมา
  const excludedSet = (req as any)?._excludedMaterialIds as Set<string> | undefined;
  if (excludedSet?.has(externalId)) { summary.skipped++; return; }
  const existing = await prisma.material.findFirst({
    where: { userId: req.user.id, externalProvider: "GOOGLE_CLASSROOM", externalId },
  });
  if (existing) {
    if (
      String(existing.textContent || "") === textContent &&
      String(existing.title || "") === String(data.title || "") &&
      String(existing.externalUrl || "") === String(data.externalUrl || "") &&
      !data.driveFileId &&
      !existing.filePath
    ) {
      summary.skipped++;
      return;
    }
    await prisma.material.update({
      where: { id: existing.id },
      data: { ...data, chunks: { deleteMany: {}, create: chunkText(textContent).map((content, chunkIndex) => ({ content, chunkIndex })) } },
    });
    summary.updated++;
  } else {
    await prisma.material.create({
      data: { ...data, chunks: { create: chunkText(textContent).map((content, chunkIndex) => ({ content, chunkIndex })) } },
    });
    summary.imported++;
  }
}
router.get("/courses", requireAuth(), async (req: any, res) => {
  try {
    const token = await getGoogleAccessToken(req.user.id);
    const courses = await listAll(CLASSROOM + "/courses?courseStates=ACTIVE", token);
    res.json(courses.map((c) => ({ id: c.id, name: c.name, section: c.section || "", description: c.description || "", updateTime: c.updateTime || null, ownerId: c.ownerId || null })));
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/**
 * ล็อกกันซิงก์ซ้อน
 *
 * เดิมมีแต่ตัวกันใน autosync (กันตัวเองกับตัวเอง) แต่ไม่กัน
 * "ซิงก์อัตโนมัติ" ชนกับ "กดซิงก์เอง" -> ทั้งคู่ findFirst ไม่เจอ -> สร้างระเบียนซ้ำ
 */
let syncRunning = false;

router.post("/sync", requireAuth(), async (req: any, res) => {
  if (syncRunning) return res.status(409).json({ error: "กำลังซิงก์อยู่ รอสักครู่แล้วลองใหม่อีกครั้ง" });
  syncRunning = true;
  try {
    const token = await getGoogleAccessToken(req.user.id);
    const courses = await listAll(CLASSROOM + "/courses?courseStates=ACTIVE", token);
    const courseMap = new Map(courses.map((c) => [String(c.id), c]));
    const suppliedMappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    const normalize = (value: unknown) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/^[0-9]{5,10}\s*[-–—:]?\s*/u, "").replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
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

    const summary = { imported: 0, updated: 0, skipped: 0, unsupported: 0, failed: 0, submissionsImported: 0, submissionsUpdated: 0, courses: [] as any[] };

    // ไฟล์ที่ผู้ใช้สั่งลบไปแล้ว (ไม่ใช่เนื้อหาวิชา) ต้องไม่ถูกดึงกลับเข้ามาใหม่โดย autosync
    // โหลด externalId ทั้งหมดที่ขึ้นทะเบียนไว้ แล้วข้ามตอนซิงก์ (กัน Material ถูกสร้างใหม่)
    const excludedRows = await prisma.excludedMaterial.findMany({ where: { userId: req.user.id }, select: { externalId: true } });
    const excludedMaterialIds = new Set(excludedRows.map((r) => r.externalId));
    (req as any)._excludedMaterialIds = excludedMaterialIds;

    for (const mapping of mappings) {
      const courseId = String(mapping?.courseId || "");
      const subjectId = String(mapping?.subjectId || "");
      const course = courseMap.get(courseId);
      if (!course || !subjectId) continue;
      const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
      if (!subject) continue;

      // ห่อด้วย try/catch รายวิชา — วิชาใดล้ม (network/parse) ต้องไม่ยกเลิกวิชาที่เหลือ
      try {

      // นำเข้าเฉพาะ "ไฟล์" เท่านั้น ตัวข้อความของประกาศ/โพสต์จะถูกข้ามทั้งหมด
      // (ประกาศยังถูกดึงมา เพราะบางประกาศมีไฟล์แนบที่ต้องการ)
      //
      // ทุก endpoint ต้องมี .catch ไม่งั้น endpoint เดียวที่ค้าง/โดน rate limit
      // (UND_ERR_HEADERS_TIMEOUT) จะทำให้ Promise.all ล้มและยกเลิก sync ทั้ง 9 วิชา
      const tolerate = (label: string) => (error: any) => {
        console.warn("[classroom] " + label + " ดึงไม่ได้ (ข้ามวิชานี้ชั่วคราว): " + String(error?.message || error).slice(0, 160));
        return [];
      };
      const [materials, work, announcements] = await Promise.all([
        listAll(CLASSROOM + "/courses/" + encodeURIComponent(courseId) + "/courseWorkMaterials", token).catch(tolerate("courseWorkMaterials")),
        listAll(CLASSROOM + "/courses/" + encodeURIComponent(courseId) + "/courseWork?orderBy=updateTime desc", token).catch(tolerate("courseWork")),
        listAll(CLASSROOM + "/courses/" + encodeURIComponent(courseId) + "/announcements", token).catch(tolerate("announcements")),
      ]);

      const items = [
        ...materials.map((x) => ({ type: "courseWorkMaterials", id: x.id, title: x.title, description: x.description, updateTime: x.updateTime, materials: x.materials })),
        ...work.map((x) => ({ type: "courseWork", id: x.id, title: x.title, description: x.description, updateTime: x.updateTime, materials: x.materials })),
        ...announcements.map((x) => ({ type: "announcements", id: x.id, title: x.text || x.title || "ประกาศใน Google Classroom", description: "", updateTime: x.updateTime, materials: x.materials })),
      ];

      let courseImported = 0;
      for (const item of items) {
        const attachments = Array.isArray(item.materials) ? item.materials : [];
        // ข้อความรบกวน (ขอลา / ขอสมัครเรียน / หาสมาชิกกลุ่ม) ไม่เอาข้อความ
        // แต่ยังเก็บ "ไฟล์ทางการ" ที่แนบมาด้วย เช่น หนังสือเชิญ คำสั่ง ประกาศ
        const itemText = String(item.title || "") + " " + String(item.description || "");
        const noisePost = isNoisePost(itemText);
        if (noisePost && !attachments.some((a: any) => {
          const did = String(a?.driveFile?.driveFile?.id || a?.driveFile?.id || "");
          return !!did && OFFICIAL_DOC_RE.test(String(a?.driveFile?.driveFile?.title || ""));
        })) {
          summary.skipped++;
          continue;
        }
        let hasDriveAttachment = false;
        for (const attachment of attachments) {
          const driveId = String(attachment?.driveFile?.driveFile?.id || attachment?.driveFile?.id || "");
          if (!driveId) continue;
          const fileTitle = String(attachment?.driveFile?.driveFile?.title || attachment?.driveFile?.title || "");
          // ไฟล์นอกวิชา (เช่น หนังสือเชิญฝึกทหาร หนังสือรับรอง) ไม่ต้องเก็บ
          if (isOffTopicFile(fileTitle)) { summary.skipped++; continue; }
          // รูปภาพ (สกรีนช็อต/รูปถ่าย) ดึงข้อความไม่ได้ เก็บมาแล้วไม่มีอะไรให้ AI ใช้
          // (เช็คซ้ำอีกครั้งหลังรู้ mimeType จริงจาก Drive)
          if (isUnusableImage(attachment?.driveFile?.driveFile?.mimeType || attachment?.driveFile?.mimeType, "")) { summary.skipped++; continue; }
          // ไฟล์งานบริหาร (ใบลา, เช็คชื่อ, งดคลาส, หลักฐานกิจกรรม)
          if (LOGISTICS_FILE_RE.test(fileTitle)) { summary.skipped++; continue; }
          // โพสต์รบกวน → เก็บเฉพาะไฟล์ทางการ ข้ามรูปภาพและใบลา
          if (noisePost && !OFFICIAL_DOC_RE.test(String(attachment?.driveFile?.driveFile?.title || ""))) continue;
          hasDriveAttachment = true;
          try {
            const externalId = materialId(courseId, item.type, String(item.id), driveId);
            if (excludedMaterialIds.has(externalId)) { summary.skipped++; continue; }
            const existing = await prisma.material.findFirst({ where: { userId: req.user.id, externalProvider: "GOOGLE_CLASSROOM", externalId } });

            // ไฟล์ที่ถูกลบ/ย้ายแล้วจะได้ 404 ทุกรอบ -> ลองซ้ำวันละครั้งพอ
            // ไม่งั้น error.log จะโตขึ้นทุก 5 นาทีไปเรื่อย ๆ
            const DEAD_RETRY_MS = 24 * 60 * 60 * 1000;
            if (existing && existing.mimeType === "text/uri-list" && !existing.filePath && existing.driveFileId === driveId) {
              const lastTry = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
              if (Date.now() - lastTry < DEAD_RETRY_MS) { summary.skipped++; continue; }
            }

            const file = await driveFileMeta(token, driveId);
            // รูปภาพที่ไม่มีคำอธิบาย — ต้องรอ driveFileMeta ก่อนจึงจะรู้ mimeType จริง
            // (Classroom API ไม่ได้ส่ง mimeType มาพร้อม attachment)
            if (isUnusableImage(file.mimeType, file.textContent)) { summary.skipped++; continue; }
            if (process.env.CLASSROOM_STRICT_FILTER === "1") {
              // ไฟล์ธุระจัดการ (Signin/ลิงก์/ประกาศ) + สไลด์รูปภาพที่ดึงข้อความไม่ได้ = ไม่ต้องเอามาใช้
              // ปิดไว้เป็นค่าเริ่มต้น เพราะผู้ใช้อยากเห็นไฟล์ครบ (ดู shouldKeepItem ด้านบน)
              const displayName = displayTitle("", file.name || fileTitle);
              if (!hasSubstantiveContent({ title: displayName, fileName: file.name || fileTitle, textContent: file.textContent })) {
                summary.skipped++; continue;
              }
            }
            const updateCandidates = [item.updateTime, file.modifiedTime].filter(Boolean).map((v) => new Date(String(v)).getTime()).filter((v) => Number.isFinite(v));
            const remoteUpdated = updateCandidates.length ? new Date(Math.max(...updateCandidates)).toISOString() : null;
            const existingText = String(existing?.textContent || "").trim();
            const existingIsMetadataOnly = !!existing && (
              existing.mimeType === "text/uri-list" ||
              existingText.includes("เปิดไฟล์ต้นฉบับใน Google Drive") ||
              existingText.includes("ไฟล์แนบจาก Google Classroom") ||
              existingText.includes("หากเปิดไม่ได้ ให้ตรวจสอบสิทธิ์เข้าถึงไฟล์ใน Google Drive")
            );
            const existingHasFile = !!existing?.filePath;
            if (existing && !existingIsMetadataOnly && (existingText.length >= 20 || existingHasFile) && remoteUpdated && existing.externalUpdatedAt && new Date(remoteUpdated) <= existing.externalUpdatedAt) {
              summary.skipped++;
              courseImported++;
              continue;
            }
            const downloaded = await downloadDriveFile(token, file);
            if (!downloaded) {
              summary.unsupported++;
              const title = String(item.title || file.name || "สื่อจาก Google Classroom").slice(0, 200);
              const description = String(item.description || "").trim();
              const textContent = [title, description, "ไฟล์ต้นฉบับ: " + String(file.name || title), "เปิดไฟล์ต้นฉบับใน Google Drive เพื่อดูสไลด์/เอกสารฉบับเต็ม"].filter(Boolean).join("\\n\\n");
              // ไฟล์ที่โหลดไม่ได้ (DOCX/CSV/XLSX) ต้องผ่านตัวกรองเหมือนทางอื่น
              // ไม่งั้นขยะ เช่น "รายชื่อสมาชิกกลุ่ม" "ประกาศกำหนดการ" จะรั่วเข้ามาโดยมี category = null
              if (!shouldKeepItem(externalId, title, file.name || null, textContent, file.mimeType)) {
                summary.skipped++;
                continue;
              }
              const data: any = {
                title, fileName: String(file.name || title).slice(0, 255), mimeType: String(file.mimeType || "application/octet-stream"),
                sourceType: "LECTURER", status: "COMPLETED", textContent,
                category: categorize(externalId, title, file.mimeType),
                sourceLabel: "Google Classroom · " + String(course.name || "Course"),
                externalProvider: "GOOGLE_CLASSROOM", externalId,
                externalUpdatedAt: remoteUpdated ? new Date(remoteUpdated) : null,
                externalUrl: file.webViewLink || null, driveFileId: driveId,
                userId: req.user.id, subjectId: subject.id,
              };
              const chunks = chunkText(textContent);
              if (existing) {
                await prisma.material.update({ where: { id: existing.id }, data: { ...data, chunks: { deleteMany: {}, create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } } });
                summary.updated++;
              } else {
                await prisma.material.create({ data: { ...data, chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } } });
                summary.imported++;
              }
              courseImported++;
              continue;
            }
            // โพสต์รบกวน → ใช้ชื่อไฟล์จริงเป็นชื่อรายการ (ไม่ใช้ข้อความโพสต์ที่ไม่เกี่ยวกับ)
            const title = displayTitle(item.title, downloaded.name).slice(0, 200);
            // ไฟล์ที่ไม่มีข้อความ (รูป/วิดีโอ) -> ใส่ชื่อ+คำอธิบายไว้ให้ค้นหาได้
            const richText = downloaded.textContent.trim();
            const storedText = richText.length >= 20
              ? richText
              : [title, String(item.description || "").trim(), "ไฟล์แนบ: " + downloaded.name, "เปิดไฟล์ต้นฉบับเพื่อดูเนื้อหา: " + (file.webViewLink || "")].filter(Boolean).join("\n\n");
            const chunks = chunkText(storedText);
            // เส้นทางหลัก (ดาวน์โหลดสำเร็จ) ต้องผ่านตัวกรองด้วย — เดิมขาดไป
            // ทำให้ขยะอย่าง "ประกาศกำหนดการ" "รายชื่อสมาชิก" รั่วเข้ามาพร้อม category = null
            if (!shouldKeepItem(externalId, title, downloaded.name, storedText, downloaded.mimeType)) {
              summary.skipped++;
              continue;
            }
            const sourceLabel = "Google Classroom · " + String(course.name || "Course");
            const savedName = Date.now() + "-" + downloaded.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const savedPath = downloaded.path || path.join(MEDIA_DIR, savedName);
            if (downloaded.buffer) fs.writeFileSync(savedPath, downloaded.buffer);
            const data: any = {
              title,
              fileName: downloaded.name.slice(0, 255),
              mimeType: downloaded.mimeType,
              sourceType: "LECTURER",
              status: "COMPLETED",
              textContent: storedText,
              pageCount: downloaded.pageCount,
              filePath: savedPath,
              category: categorize(externalId, title, downloaded.mimeType),
              sourceLabel,
              externalProvider: "GOOGLE_CLASSROOM",
              externalId,
              externalUpdatedAt: remoteUpdated ? new Date(remoteUpdated) : null,
              externalUrl: file.webViewLink || null,
              driveFileId: driveId,
              userId: req.user.id,
              subjectId: subject.id,
            };
            if (existing) {
              await prisma.material.update({ where: { id: existing.id }, data: { ...data, chunks: { deleteMany: {}, create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } } });
              summary.updated++;
            } else {
              await prisma.material.create({ data: { ...data, chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } } });
              summary.imported++;
            }
            courseImported++;
          } catch (error) {
            summary.failed++;
            console.warn("Classroom material import failed", course.name, item.title, error);
            // Keep a visible, clickable entry even when Drive metadata/download is unavailable.
            try {
              const externalId = materialId(courseId, item.type, String(item.id), driveId);
              // อยู่ใน for-loop ของ attachment — ต้อง "ข้ามไฟล์นี้" (continue) ไม่ใช่ return
              // (return = ออกจาก handler ทั้งหมด = sync ค้างกลางคัน + ไม่ส่ง response → autosync โดน timeout 15 นาที)
              if (excludedMaterialIds.has(externalId)) { summary.skipped++; continue; }
              const existing = await prisma.material.findFirst({ where: { userId: req.user.id, externalProvider: "GOOGLE_CLASSROOM", externalId } });
              const title = String(item.title || attachment?.driveFile?.driveFile?.title || "สื่อจาก Google Classroom").slice(0, 200);
              const textContent = [title, String(item.description || "").trim(), "ไฟล์แนบจาก Google Classroom", "หากเปิดไม่ได้ ให้ตรวจสอบสิทธิ์เข้าถึงไฟล์ใน Google Drive"].filter(Boolean).join("\\n\\n");
              if (!shouldKeepItem(externalId, title, attachment?.driveFile?.driveFile?.title || null, textContent, attachment?.driveFile?.driveFile?.mimeType)) { summary.skipped++; continue; }
              const data: any = {
                title, fileName: String(attachment?.driveFile?.driveFile?.title || title).slice(0, 255),
                mimeType: "text/uri-list", sourceType: "LECTURER", status: "COMPLETED", textContent,
                category: categorize(externalId, title, attachment?.driveFile?.driveFile?.mimeType),
                sourceLabel: "Google Classroom · " + String(course.name || "Course"),
                externalProvider: "GOOGLE_CLASSROOM", externalId,
                externalUpdatedAt: item.updateTime ? new Date(item.updateTime) : null,
                externalUrl: "https://drive.google.com/open?id=" + encodeURIComponent(driveId), driveFileId: driveId,
                userId: req.user.id, subjectId: subject.id,
              };
              const chunks = chunkText(textContent);
              if (existing) {
                await prisma.material.update({ where: { id: existing.id }, data: { ...data, chunks: { deleteMany: {}, create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } } });
                summary.updated++;
              } else {
                await prisma.material.create({ data: { ...data, chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) } } });
                summary.imported++;
              }
              courseImported++;
            } catch (fallbackError) {
              console.warn("Classroom metadata fallback failed", course.name, item.title, fallbackError);
            }
          }
        }
        // รับสื่อที่ไม่ใช่ไฟล์ Drive: คลิป YouTube, แบบฟอร์ม, ลิงก์
        const mediaLinks = attachments.map((a: any) => {
          if (a?.youtubeVideo?.id) return { kind: "วิดีโอ YouTube", url: "https://www.youtube.com/watch?v=" + encodeURIComponent(String(a.youtubeVideo.id)), title: String(a.youtubeVideo.title || "วิดีโอ YouTube") };
          if (a?.form?.formUrl) return { kind: "แบบฟอร์ม", url: String(a.form.formUrl), title: String(a.form.title || "แบบฟอร์ม") };
          if (a?.link?.url) return { kind: "ลิงก์", url: String(a.link.url), title: String(a.link.title || "ลิงก์การเรียน") };
          return null;
        }).filter(Boolean) as { kind: string; url: string; title: string }[];

        // ลิงก์ประกาศล้วน (Facebook/เข้าเรียนออนไลน์) ไม่ใช่เนื้อหา — ต้องผ่านกฎเดียวกับข้อความด้วย
        // รวม URL ของลิงก์เข้าไปตรวจด้วย เพราะลิงก์ Facebook อยู่ใน mediaLinks ไม่ได้อยู่ใน title
        const linkProbe = mediaLinks.map((l: any) => String(l.url || "") + " " + String(l.title || "") + " " + String(l.kind || "")).join(" ");
        if (mediaLinks.length && !noisePost && isStudyContent(String(item.title || "") + " " + String(item.description || "") + " " + linkProbe)) {
          const itemTitle = String(item.title || mediaLinks[0].title || "สื่อจาก Google Classroom").slice(0, 200);
          const description = String(item.description || "").trim();
          const textContent = [itemTitle, description, ...mediaLinks.map((l) => l.kind + ": " + l.title + " — " + l.url)].filter(Boolean).join("\n\n");
          const externalId = materialId(courseId, item.type, String(item.id), "media");
          if (!shouldKeepItem(externalId, itemTitle, null, textContent)) { summary.skipped++; } else {
          const existing = await prisma.material.findFirst({ where: { userId: req.user.id, externalProvider: "GOOGLE_CLASSROOM", externalId } });
          const data: any = {
            title: itemTitle,
            fileName: null,
            mimeType: "text/uri-list",
            sourceType: "LECTURER",
            status: "COMPLETED",
            textContent,
            category: categorize(externalId, itemTitle, undefined),
            sourceLabel: "Google Classroom · " + String(course.name || "Course"),
            externalProvider: "GOOGLE_CLASSROOM",
            externalId,
            externalUpdatedAt: item.updateTime ? new Date(item.updateTime) : null,
            externalUrl: mediaLinks[0].url,
            userId: req.user.id,
            subjectId: subject.id,
          };
          await writeMaterialIfChanged(req, externalId, subject.id, data, textContent, summary);
          courseImported++;
          }
        }

        // รายการที่ไม่มีสื่อเลย = อาจเป็นคำอธิบายงาน (เก็บ) หรือประกาศบริหาร (ไม่เก็บ)
        if (!noisePost && !hasDriveAttachment && !mediaLinks.length) {
          const itemTitle = String(item.title || "").trim();
          const description = String(item.description || "").trim();
          const body = [itemTitle, description].filter(Boolean).join("\n");
          // ตารางเรียน/ตารางสอบ/ลิงก์สังคม ปล่อยไว้จะหลอก AI ให้สร้างหัวข้อมั่ว
          if ((itemTitle || description) && !isStudyContent(body)) {
            summary.skipped++;
            continue;
          }
          if (itemTitle || description) {
            const textContent = [itemTitle, description].filter(Boolean).join("\n\n");
            const externalId = materialId(courseId, item.type, String(item.id), "text");
            if (!shouldKeepItem(externalId, itemTitle || description, null, textContent)) { summary.skipped++; continue; }
            const existing = await prisma.material.findFirst({ where: { userId: req.user.id, externalProvider: "GOOGLE_CLASSROOM", externalId } });
            const data: any = {
              title: (itemTitle || description).slice(0, 200),
              fileName: null,
              mimeType: "text/plain",
              sourceType: "LECTURER",
              status: "COMPLETED",
              textContent,
              category: categorize(externalId, itemTitle || description, undefined),
              sourceLabel: "Google Classroom · " + String(course.name || "Course"),
              externalProvider: "GOOGLE_CLASSROOM",
              externalId,
              externalUpdatedAt: item.updateTime ? new Date(item.updateTime) : null,
              externalUrl: null,
              userId: req.user.id,
              subjectId: subject.id,
            };
            await writeMaterialIfChanged(req, externalId, subject.id, data, textContent, summary);
            courseImported++;
          }
        }
      }
      if (courseImported) await prisma.subject.update({ where: { id: subject.id }, data: { status: "IN_PROGRESS" } });

      // ดึง "งานที่นักเรียนเคยส่ง" ด้วย เพื่อให้อาจารย์ AI สร้างโจทย์ฝึกจากวิธีทำจริงได้
      let submissionStats: any = null;
      if (req.body?.includeSubmissions !== false) {
        try {
          submissionStats = await syncSubmissionsForCourse(token, courseId, subject.id, req.user.id, String(course.name || ""));
          summary.submissionsImported += submissionStats.imported;
          summary.submissionsUpdated += submissionStats.updated;
        } catch (error) {
          console.warn("นำเข้างานที่ส่งไม่สำเร็จ", course.name, String(error));
        }
      }

      summary.courses.push({ courseId, courseName: course.name, subjectId: subject.id, imported: courseImported, submissions: submissionStats });
      } catch (courseError) {
        summary.failed++;
        console.warn("[classroom] ซิงก์วิชา " + String(course.name || courseId).slice(0, 60) + " ไม่สำเร็จ (ข้ามไปวิชาถัดไป): " + String(courseError instanceof Error ? courseError.message : courseError).slice(0, 200));
      }
    }
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  } finally {
    syncRunning = false;
  }
});

export default router;
