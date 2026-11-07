/**
 * ตัวกลางเรียก Google Classroom API
 *
 * ข้อควรระวังที่เคยพลาดและแก้แล้ว:
 *  1. โฮสต์ต้องเป็น classroom.googleapis.com ไม่ใช่ www.googleapis.com/classroom/v1
 *     (ตัวหลังตอบ HTML 404 -> JSON.parse โยน error)
 *  2. courses.list รับ ?courseStates=ACTIVE แต่ courseWork.list **ไม่รับ** พารามิเตอร์นี้
 *     (ถ้าใส่จะได้ 400 INVALID_ARGUMENT แล้วได้งาน 0 ชิ้นแบบเงียบ ๆ)
 */

export const CLASSROOM_API = "https://classroom.googleapis.com/v1";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";

export async function classroomJson(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Google Classroom API ${res.status}`);
  return body;
}

/** ไล่ทุกหน้า คืนรายการที่รวมแล้วจาก key ที่ต้องการ */
export async function listAllPages<T = any>(
  url: string,
  accessToken: string,
  keys: string[],
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const body: any = await classroomJson(
      url + sep + "pageSize=100" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""),
      accessToken,
    );
    let matched = 0;
    for (const key of keys) {
      if (Array.isArray(body[key])) { out.push(...body[key]); matched++; }
      // คีย์ไม่ตรง = ข้อมูลหายเงียบ ๆ ต้องเห็นสัญญาณเตือน ไม่ใช่คืน [] เงียบ ๆ
      else console.warn("[classroom] ไม่พบฟิลด์ '" + key + "' ในคำตอบ — คีย์อาจผิด (endpoint ถูกแต่ข้อมูลจะไม่เข้า)", url);
    }
    void matched;
    pageToken = String(body.nextPageToken || "");
    if (!pageToken) break;
  }
  return out;
}

export const listCourses = (token: string) =>
  listAllPages(`${CLASSROOM_API}/courses?courseStates=ACTIVE`, token, ["courses"]);

/** สำคัญ: ห้ามใส่ courseStates ที่นี่ */
export const listCourseWork = (token: string, courseId: string) =>
  listAllPages(`${CLASSROOM_API}/courses/${encodeURIComponent(courseId)}/courseWork`, token, ["courseWork"]);

export const listCourseWorkMaterials = (token: string, courseId: string) =>
  // ระวัง: Classroom API คืนฟิลด์ชื่อ "courseWorkMaterial" (เอกพจพานย์) ไม่ใช่พหูพจน์
  // ถ้าใส่ผิดจะได้ [] เงียบ ๆ โดยไม่มี error — เคยทำให้ "ทรัพยากร" ของทุกวิชาหายไปทั้งหมด
  listAllPages(`${CLASSROOM_API}/courses/${encodeURIComponent(courseId)}/courseWorkMaterials`, token, ["courseWorkMaterial"]);

export const listAnnouncements = (token: string, courseId: string) =>
  listAllPages(`${CLASSROOM_API}/courses/${encodeURIComponent(courseId)}/announcements`, token, ["announcements"]);

/** งานที่ "ตัวเรสวสวสว"ส่ง (userId=me) — ต้องมี scope classroom.coursework.me.readonly */
export const listMySubmissions = (token: string, courseId: string, workId: string) =>
  listAllPages(
    `${CLASSROOM_API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}/studentSubmissions?userId=me`,
    token,
    ["studentSubmissions"],
  );

export type SubmissionFile = {
  driveFileId: string;
  title: string;
  mimeType: string;
  size?: number;
  webViewLink?: string;
};

/**
 * ดึงรายการไฟล์ที่นักเรียนแนบ จากทั้งทางตรง (driveFile)
 * และทางอ้อม (attachment → assignmentSubmission → ... ) รวมถึงลิงก์ Google Docs/Drive
 *
 * คืน: { files, links }
 */
export function extractSubmissionFiles(submission: any): {
  files: SubmissionFile[];
  links: { url: string; title: string }[];
} {
  const files: SubmissionFile[] = [];
  const links: { url: string; title: string }[] = [];
  const seen = new Set<string>();

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const df = node.driveFile;
    if (df) {
      const id = String(df.driveFile?.id || df.id || "");
      if (id && !seen.has(id)) {
        seen.add(id);
        files.push({
          driveFileId: id,
          title: String(df.driveFile?.title || df.title || "ไฟล์แนบ"),
          mimeType: String(df.driveFile?.mimeType || df.mimeType || "application/octet-stream"),
          webViewLink: df.driveFile?.alternateLink || df.alternateLink || undefined,
        });
      }
    }

    if (node.link?.url) {
      const url = String(node.link.url);
      if (url && !links.some((l) => l.url === url)) {
        links.push({ url, title: String(node.link.title || url) });
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };

  visit(submission?.assignmentSubmission?.attachments);
  return { files, links };
}

/** ค้นหาว่า submission มีเนื้อหาพอจะใช้สร้างโจทย์ได้ไหม */
export function submissionHasContent(entry: any): boolean {
  const a = entry?.assignmentSubmission || {};
  const text = String(a.draftResponse || "").trim();
  if (text.length >= 40) return true;
  const { files, links } = extractSubmissionFiles(entry);
  return files.length > 0 || links.length > 0;
}