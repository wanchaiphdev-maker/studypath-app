/**
 * ดาวน์โหลดไฟล์จาก Google Drive แล้วดึงข้อความออกมา
 * ใช้ร่วมกันทั้ง pipeline นำเข้าไฟล์ประกอบการเรียน และ pipeline นำเข้างานที่นักเรียนส่ง
 */
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { PDFParse } from "pdf-parse";
import { DRIVE_API } from "./classroom-api";

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), "storage", "materials"));
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export function extractPptxText(buffer: Buffer) {
  try {
    const zip = new AdmZip(buffer);
    return zip
      .getEntries()
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => Number(a.entryName.match(/slide(\d+)/i)?.[1] || 0) - Number(b.entryName.match(/slide(\d+)/i)?.[1] || 0))
      .map((entry, index) => {
        const xml = entry.getData().toString("utf8");
        const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) =>
          m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        );
        return "[สไลด์ " + (index + 1) + "] " + texts.join(" ");
      })
      .filter((x) => x.length > 10)
      .join("\n\n");
  } catch {
    return "";
  }
}

export function extractDocxText(buffer: Buffer) {
  try {
    const zip = new AdmZip(buffer);
    const parts: string[] = [];
    const xml = zip.getEntry("word/document.xml")?.getData().toString("utf8") || "";
    for (const p of xml.split(/<\/w:p>/i)) {
      const texts = Array.from(p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)).map((m) =>
        m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      );
      const line = texts.join("").trim();
      if (line) parts.push(line);
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

export function extractOdfText(buffer: Buffer) {
  try {
    const zip = new AdmZip(buffer);
    const xml = zip.getEntry("content.xml")?.getData().toString("utf8") || "";
    const texts = Array.from(xml.matchAll(/<text:(?:p|h)[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)).map((m) =>
      m[1].replace(/<[^>]+>/g, "")
    );
    return texts.join("\n\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  } catch {
    return "";
  }
}

export async function driveFileMeta(accessToken: string, fileId: string) {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime,webViewLink`, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Google Drive ${res.status}`);
  return body;
}

export type DownloadedFile = {
  buffer: Buffer | null;
  path?: string;
  name: string;
  mimeType: string;
  textContent: string;
  pageCount?: number;
};

/**
 * ดาวน์โหลด + แปลงเป็นข้อความ
 * คืน null เมื่อเป็นชนิดที่ไม่มีเนื้อหาอ่านได้ (Forms / Scripts / Sites)
 */
export async function downloadDriveFile(accessToken: string, file: any): Promise<DownloadedFile | null> {
  const googleMime = String(file.mimeType || "");
  let mimeType = googleMime;
  let name = String(file.name || "ไฟล์แนบ");
  const rawUrl = `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`;
  const exportUrl = (target: string) => `${DRIVE_API}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(target)}`;
  let url = rawUrl;

  if (googleMime.startsWith("application/vnd.google-apps.")) {
    if (googleMime === "application/vnd.google-apps.document") {
      mimeType = "text/plain"; name += ".txt"; url = exportUrl("text/plain");
    } else if (googleMime === "application/vnd.google-apps.presentation") {
      mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      name += ".pptx"; url = exportUrl(mimeType);
    } else if (googleMime === "application/vnd.google-apps.spreadsheet") {
      mimeType = "text/csv"; name += ".csv"; url = exportUrl("text/csv");
    } else if (googleMime === "application/vnd.google-apps.drawing") {
      mimeType = "image/png"; name += ".png"; url = exportUrl("image/png");
    } else {
      return null;
    }
  }

  const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (!response.ok) throw new Error("ดาวน์โหลดไฟล์ " + name + " ไม่สำเร็จ (" + response.status + ")");

  const contentLength = Number(response.headers.get("content-length") || 0);
  const isMedia = /^(video|audio|image)\//i.test(mimeType);

  // ไฟล์สื่อใหญ่ -> สตรีมลงดิสก์ตรงๆ ไม่งั้นกิน RAM
  if (isMedia && (contentLength > 8 * 1024 * 1024 || contentLength === 0)) {
    const streamName = Date.now() + "-" + name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const target = path.join(MEDIA_DIR, streamName);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(target);
      Readable.fromWeb(response.body as any).on("error", reject).pipe(out);
      out.on("finish", () => resolve());
      out.on("error", reject);
    });
    return { buffer: null, path: target, name, mimeType, textContent: "" };
  }

  const array = new Uint8Array(await response.arrayBuffer());
  if (array.byteLength > 60 * 1024 * 1024) throw new Error("ไฟล์ " + name + " ใหญ่เกิน 60MB");
  const buffer = Buffer.from(array);

  let textContent = "";
  let pageCount: number | undefined;

  if (mimeType === "application/pdf") {
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      textContent = String(result.text || "").trim();
      pageCount = Number(result.total || 0) || undefined;
      await parser.destroy();
    } catch {
      textContent = "";
    }
  } else if (mimeType.includes("presentationml") || /\.pptx?$/i.test(name)) {
    textContent = extractPptxText(buffer);
  } else if (mimeType.includes("wordprocessingml") || /\.docx$/i.test(name)) {
    textContent = extractDocxText(buffer);
  } else if (/vnd\.(oasis\.opendocument|sun\.xml\.)/i.test(mimeType) || /\.(odt|odp|ods)$/i.test(name)) {
    textContent = extractOdfText(buffer);
  } else if (mimeType.startsWith("text/") || /\.(txt|csv|md|json|html?|xml|rtf|py|js|ts|java|c|cpp|cs|sql|ipynb)$/i.test(name)) {
    textContent = buffer.toString("utf8").replace(/<[^>]+>/g, " ").trim();
  }

  return { buffer, name, mimeType, textContent, pageCount };
}