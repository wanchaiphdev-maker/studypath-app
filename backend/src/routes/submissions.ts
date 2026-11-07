/**
 * นำเข้างานที่นักเรียนเคย "ส่ง" ใน Google Classroom
 *
 * เหตุผลที่ต้องมี: งานที่นักเรียนทำเองสะท้อนว่าเขา "คิดและลงมือทำอย่างไร"
 * ซึ่งต่างจากโจทย์ในใบงาน — ใช้สร้างโจทย์ฝึกที่ตรงกับวิธีทำจริงของเขาได้
 */
import { prisma } from "../auth";
import { listCourseWork, listMySubmissions, extractSubmissionFiles, type SubmissionFile } from "./classroom-api";
import { driveFileMeta, downloadDriveFile } from "./classroom-files";

export type SubmissionSyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  withText: number;
  filesFound: number;
};

const subId = (courseId: string, workId: string, extra = "") =>
  ["classroom-sub", courseId, workId, extra].filter(Boolean).join(":");

/**
 * ชนิดไฟล์ที่ไม่มีทางดึงข้อความออกมาได้ — ไม่ต้องดาวน์โหลดให้เสียเวลา
 * (งานส่วนใหญ่ในคลาสจริงเป็นภาพหน้าจอ/วิดีโอ ซึ่ง OCR ไม่ได้อยู่แล้ว)
 */
function isDeadEnd(mimeType: string, title: string) {
  if (/^(image|video|audio)\//i.test(mimeType)) return true;
  return /\.(jpe?g|png|gif|webp|heic|mp4|mov|m4a|mp3|webm)$/i.test(title);
}

/** ดึงข้อความจากไฟล์แนบ (ขนาดคงที่ + ขนาดไฟล์ไม่เกิน 25MB) */
async function textFromAttachments(token: string, files: SubmissionFile[], maxFiles = 3, budget = { left: 0 }) {
  const chunks: string[] = [];
  const meta: any[] = [];
  let driveFileId = "";

  const usable = files.filter((f) => !isDeadEnd(f.mimeType, f.title)).slice(0, maxFiles);
  // ไฟล์ที่เหลือ (รูป/คลิป) เก็บชื่อไว้เป็นหลักฐาน แต่ไม่ต้องดาวน์โหลด
  for (const f of files) {
    if (!usable.includes(f)) meta.push({ title: f.title, mimeType: f.mimeType, text: "", skipped: true });
  }

  // ดาวน์โหลดพร้อมกัน 3 ไฟล์ เพื่อไม่ให้ช้าเกินไป
  const concurrency = 3;
  let index = 0;
  const worker = async () => {
    while (index < usable.length) {
      const f = usable[index++];
      if (budget.left <= 0) return;
      budget.left--;
      try {
        const meta0 = await driveFileMeta(token, f.driveFileId);
        const size = Number(meta0.size || 0);
        if (size > 25 * 1024 * 1024) {
          meta.push({ title: f.title, mimeType: f.mimeType, text: "", tooBig: true });
          continue;
        }
        const got = await downloadDriveFile(token, meta0);
        if (!got) {
          meta.push({ title: f.title, mimeType: f.mimeType, text: "" });
          continue;
        }
        const text = String(got.textContent || "").trim();
        // เก็บเฉพาะข้อความที่มีเนื้อหาจริง (PDF ที่เป็นรูปจะได้แค่ "-- 1 of 3 --")
        if (text.length >= 40) chunks.push("[จากไฟล์: " + got.name + "]\n" + text.slice(0, 4000));
        meta.push({ title: got.name, mimeType: got.mimeType, chars: text.length });
        if (!driveFileId) driveFileId = f.driveFileId;
      } catch (error) {
        meta.push({ title: f.title, mimeType: f.mimeType, error: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, usable.length) }, worker));

  return { text: chunks.join("\n\n"), meta, driveFileId };
}

/**
 * นำเข้างานที่ส่งของวิชาหนึ่ง
 * @param token access token ของผู้ใช้
 * @param courseId รหัสคลาส
 * @param subjectId วิชาใน StudyPath
 * @param userId ผู้ใช้
 * @param maxWork จำกันจำนวนชิ้นงานที่ดู (ป้องกัน API ช้าเกินไป)
 */
export async function syncSubmissionsForCourse(
  token: string,
  courseId: string,
  subjectId: string,
  userId: string,
  courseName: string,
  maxWork = 40,
  downloadBudget = 20,
): Promise<SubmissionSyncResult> {
  const result: SubmissionSyncResult = { imported: 0, updated: 0, skipped: 0, failed: 0, withText: 0, filesFound: 0 };
  // จำกัดจำนวนไฟล์ที่ดาวน์โหลดต่อรอบ เพื่อไม่ให้ซิงก์ท่วมเวลา (ทำรอบถัดไปต่อ)
  const budget = { left: downloadBudget };

  let works: any[] = [];
  try {
    works = await listCourseWork(token, courseId);
  } catch (error) {
    console.warn("อ่านรายการงานไม่สำเร็จ", courseName, String(error));
    return result;
  }

  // รอบแรก: ดึงรายการงานทั้งหมดแบบขนาน (เรียก API ถูกแต่ช้า ถ้าทำทีละอันหนึ่งจะนานมาก)
  const pending: { work: any; entry: any; files: any[]; links: any[]; draft: string }[] = [];
  const queue = works.slice(0, maxWork);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, async () => {
      while (cursor < queue.length) {
        const work = queue[cursor++];
        let entries: any[] = [];
        try {
          entries = await listMySubmissions(token, courseId, String(work.id));
        } catch {
          continue; // งานบางชิ้น (เช่นแบบทดสอบ) อ่านไม่ได้ -> ข้าม
        }
        for (const entry of entries) {
          const assignment = entry.assignmentSubmission || {};
          const { files, links } = extractSubmissionFiles(entry);
          const draft = String(assignment.draftResponse || "").trim();
          pending.push({ work, entry, files, links, draft });
        }
      }
    }),
  );

  // งานที่พิมพ์คำตอบเองยาวพอใช้ ให้ความสำคัญก่อน (ไม่ต้องดาวน์โหลดไฟล์ให้เสียเวลา)
  pending.sort((a, b) => (b.draft.length >= 40 ? 1 : 0) - (a.draft.length >= 40 ? 1 : 0));

  for (const item of pending) {
    {
      const { work, entry, files, links, draft } = item;
      if (draft.length < 40 && !files.length && !links.length) {
        result.skipped++;
        continue;
      }

      result.filesFound += files.length;

      const attachments = draft.length >= 60
        ? { text: "", meta: [] as any[], driveFileId: "" } // มีคำตอบพอแล้ว ไม่ต้องดาวน์โหลด
        : files.length
          ? await textFromAttachments(token, files, 3, budget)
          : { text: "", meta: [] as any[], driveFileId: "" };

      const linkText = links
        .map((l) => "[ลิงก์ที่ส่ง] " + l.title + " - " + l.url)
        .join("\n");

      const bodyParts = [
        draft ? "[คำตอบที่พิมพ์]\n" + draft : "",
        attachments.text,
        linkText,
      ].filter(Boolean);

      const textContent = bodyParts.join("\n\n").trim();
      if (!textContent) {
        result.skipped++;
        continue;
      }
      if (textContent.length >= 60) result.withText++;

      const externalId = subId(courseId, String(work.id), files[0]?.driveFileId || "text");
      const data: any = {
        title: String(work.title || "งานที่ส่ง").slice(0, 200),
        assignmentDescription: String(work.description || "").trim().slice(0, 4000) || null,
        textContent,
        state: String(entry.state || ""),
        grade: entry.assignedGrade?.value != null ? String(entry.assignedGrade.value) : null,
        late: !!entry.late,
        submittedAt: entry.lastModifiedTime ? new Date(entry.lastModifiedTime) : null,
        maxScore: work.maxPoints != null ? Number(work.maxPoints) : null,
        attachmentsJson: attachments.meta.length || links.length ? { files: attachments.meta, links } : undefined,
        sourceLabel: "งานที่ส่ง — " + String(courseName || "Google Classroom"),
        externalProvider: "GOOGLE_CLASSROOM",
        externalId,
        externalUrl: files[0]?.webViewLink || links[0]?.url || null,
        driveFileId: attachments.driveFileId || null,
        userId,
        subjectId,
      };

      try {
        const existing = await prisma.submission.findFirst({
          where: { userId, externalProvider: "GOOGLE_CLASSROOM", externalId },
        });
        if (existing) {
          // อัปเดตเฉพาะเมื่อเนื้อหาเปลี่ยนจริง กันเขียนทุก 5 นาที
          if (existing.textContent === textContent && String(existing.state || "") === data.state) {
            result.skipped++;
          } else {
            await prisma.submission.update({ where: { id: existing.id }, data });
            result.updated++;
          }
        } else {
          await prisma.submission.create({ data });
          result.imported++;
        }
      } catch (error) {
        result.failed++;
        console.warn("บันทึกงานที่ส่งไม่สำเร็จ", String(work.title), String(error));
      }
    }
  }

  return result;
}