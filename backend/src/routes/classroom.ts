import { Router } from "express";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";
import { prisma, requireAuth } from "../auth";
import { getGoogleAccessToken } from "./google";

const router = Router();
const CLASSROOM = "https://classroom.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com/drive/v3";
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

function extractPptxText(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => Number(a.entryName.match(/slide(\d+)/i)?.[1] || 0) - Number(b.entryName.match(/slide(\d+)/i)?.[1] || 0))
    .map((entry, index) => {
      const xml = entry.getData().toString("utf8");
      const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
      return "[สไลด์ " + (index + 1) + "] " + texts.join(" ");
    })
    .filter((x) => x.length > 10)
    .join("\n\n");
}

async function googleJson(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const body: any = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "Google API error " + response.status);
  return body;
}

async function listAll(url: string, accessToken: string) {
  const out: any[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const join = url.includes("?") ? "&" : "?";
    const body = await googleJson(url + join + "pageSize=100" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""), accessToken);
    for (const key of ["courses", "courseWorkMaterials", "courseWork"]) if (Array.isArray(body[key])) out.push(...body[key]);
    pageToken = String(body.nextPageToken || "");
    if (!pageToken) break;
  }
  return out;
}

async function driveFile(accessToken: string, fileId: string) {
  return googleJson(DRIVE + "/files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,modifiedTime,webViewLink", accessToken);
}

async function downloadDriveFile(accessToken: string, file: any) {
  const googleMime = String(file.mimeType || "");
  let mimeType = googleMime;
  let name = String(file.name || "Classroom material");
  let url = DRIVE + "/files/" + encodeURIComponent(file.id) + "?alt=media";
  if (googleMime === "application/vnd.google-apps.document") {
    mimeType = "text/plain";
    name += ".txt";
    url = DRIVE + "/files/" + encodeURIComponent(file.id) + "/export?mimeType=text/plain";
  } else if (googleMime === "application/vnd.google-apps.presentation") {
    mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    name += ".pptx";
    url = DRIVE + "/files/" + encodeURIComponent(file.id) + "/export?mimeType=" + encodeURIComponent(mimeType);
  } else if (!["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-powerpoint"].includes(googleMime)) {
    return null;
  }
  const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (!response.ok) throw new Error("ดาวน์โหลดไฟล์ " + name + " ไม่สำเร็จ (" + response.status + ")");
  const array = new Uint8Array(await response.arrayBuffer());
  if (array.byteLength > 15 * 1024 * 1024) throw new Error("ไฟล์ " + name + " ใหญ่เกิน 15MB");
  const buffer = Buffer.from(array);
  let textContent = "";
  let pageCount: number | undefined;
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    textContent = String(result.text || "").trim();
    pageCount = Number(result.total || 0) || undefined;
    await parser.destroy();
  } else if (mimeType.includes("presentationml") || /\.pptx?$/i.test(name)) {
    textContent = extractPptxText(buffer);
  } else {
    textContent = buffer.toString("utf8").trim();
  }
  return { buffer, name, mimeType, textContent, pageCount };
}

function materialId(courseId: string, itemType: string, itemId: string, driveId: string) {
  return ["classroom", courseId, itemType, itemId, driveId].join(":");
}

router.get("/status", requireAuth(), async (req: any, res) => {
  const connection = await prisma.googleConnection.findUnique({ where: { userId: req.user.id }, select: { connectedAt: true, updatedAt: true, expiresAt: true, scope: true } });
  res.json({ connected: !!connection, connectedAt: connection?.connectedAt || null, updatedAt: connection?.updatedAt || null, expiresAt: connection?.expiresAt || null, scope: connection?.scope || null });
});

router.get("/courses", requireAuth(), async (req: any, res) => {
  try {
    const token = await getGoogleAccessToken(req.user.id);
    const courses = await listAll(CLASSROOM + "/courses?courseStates=ACTIVE", token);
    res.json(courses.map((c) => ({ id: c.id, name: c.name, section: c.section || "", description: c.description || "", updateTime: c.updateTime || null, ownerId: c.ownerId || null })));
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

router.post("/sync", requireAuth(), async (req: any, res) => {
  try {
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (!mappings.length) return res.status(400).json({ error: "กรุณาเลือก Classroom และวิชาอย่างน้อย 1 คู่" });
    const token = await getGoogleAccessToken(req.user.id);
    const courses = await listAll(CLASSROOM + "/courses?courseStates=ACTIVE", token);
    const courseMap = new Map(courses.map((c) => [String(c.id), c]));
    const summary = { imported: 0, updated: 0, skipped: 0, unsupported: 0, failed: 0, courses: [] as any[] };

    for (const mapping of mappings) {
      const courseId = String(mapping?.courseId || "");
      const subjectId = String(mapping?.subjectId || "");
      const course = courseMap.get(courseId);
      if (!course || !subjectId) continue;
      const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
      if (!subject) continue;

      const [materials, work] = await Promise.all([
        listAll(CLASSROOM + "/courses/" + encodeURIComponent(courseId) + "/courseWorkMaterials", token),
        listAll(CLASSROOM + "/courses/" + encodeURIComponent(courseId) + "/courseWork", token),
      ]);

      const items = [
        ...materials.map((x) => ({ type: "courseWorkMaterials", id: x.id, title: x.title, description: x.description, updateTime: x.updateTime, materials: x.materials })),
        ...work.map((x) => ({ type: "courseWork", id: x.id, title: x.title, description: x.description, updateTime: x.updateTime, materials: x.materials })),
      ];

      let courseImported = 0;
      for (const item of items) {
        const attachments = Array.isArray(item.materials) ? item.materials : [];
        for (const attachment of attachments) {
          const driveId = String(attachment?.driveFile?.driveFile?.id || attachment?.driveFile?.id || "");
          if (!driveId) continue;
          try {
            const file = await driveFile(token, driveId);
            const externalId = materialId(courseId, item.type, String(item.id), driveId);
            const existing = await prisma.material.findFirst({ where: { userId: req.user.id, externalProvider: "GOOGLE_CLASSROOM", externalId } });
            const remoteUpdated = item.updateTime || file.modifiedTime || null;
            if (existing && remoteUpdated && existing.externalUpdatedAt && new Date(remoteUpdated) <= existing.externalUpdatedAt) {
              summary.skipped++;
              continue;
            }
            const downloaded = await downloadDriveFile(token, file);
            if (!downloaded || downloaded.textContent.length < 20) {
              summary.unsupported++;
              continue;
            }
            const chunks = chunkText(downloaded.textContent);
            const title = String(item.title || downloaded.name).slice(0, 200);
            const sourceLabel = "Google Classroom · " + String(course.name || "Course");
            const savedName = Date.now() + "-" + downloaded.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const savedPath = path.join(MEDIA_DIR, savedName);
            fs.writeFileSync(savedPath, downloaded.buffer);
            const data: any = {
              title,
              fileName: downloaded.name.slice(0, 255),
              mimeType: downloaded.mimeType,
              sourceType: "LECTURER",
              status: "COMPLETED",
              textContent: downloaded.textContent,
              pageCount: downloaded.pageCount,
              filePath: savedPath,
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
          }
        }
      }
      if (courseImported) await prisma.subject.update({ where: { id: subject.id }, data: { status: "IN_PROGRESS" } });
      summary.courses.push({ courseId, courseName: course.name, subjectId: subject.id, imported: courseImported });
    }
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

export default router;
