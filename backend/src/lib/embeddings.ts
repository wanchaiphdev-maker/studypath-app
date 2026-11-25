/**
 * Semantic search สำหรับ Knowledge Base ของ StudyPath
 *
 * ปัญหาเดิม: retrieve() นับคำที่ตรงกันแบบตัวอักษร ทำให้คำถามที่ใช้คำต่างจากไฟล์
 * (คำพ้อง / คำอธิบายยาว / ภาษาอังกฤษ) มองไม่เห็นเนื้อหาที่เกี่ยวข้องเลย
 *
 * ที่นี่เก็บเวกเตอร์ของแต่ละ chunk ไว้ใน MaterialChunk.embedding (มี field อยู่แล้ว)
 * รูปแบบ: { d: 768, v: "<base64 ของ Float32Array>" } — กะทัดรัดกว่า JSON array ~8 เท่า
 */
import { prisma } from "../auth";

const MODEL = process.env.AI_EMBED_MODEL || "gemini-embedding-001";
const DIMS = Number(process.env.AI_EMBED_DIMS || 768);
const BATCH = 32;
const MAX_CHARS = 2000;

export type StoredVector = { d: number; v: string };

function endpoint() {
  return process.env.AI_BASE_URL?.replace(/\/$/, "");
}

export function embeddingsEnabled() {
  return !!(endpoint() && process.env.AI_API_KEY);
}

/** อ่านเวลาที่ควรลองใหม่จากข้อความ 429 ของ Google (เช่น "Please retry in 22.2s") */
function retryDelayMs(body: string, fallback: number) {
  const seconds = body.match(/retry in ([\d.]+)s/i)?.[1] || body.match(/"retryDelay"\s*:\s*"([\d.]+)s"/)?.[1];
  const ms = seconds ? Number(seconds) * 1000 : fallback;
  return Math.min(65000, Math.max(1000, ms));
}

/** ฝังข้อความหลายข้อความพร้อมกัน — คืน array ที่ตรงลำดับกับ input (null = ฝังไม่ได้)
 *  opts ใช้จำกัดเวลา/จำนวนครั้งสำหรับ "คำถามของผู้ใช้" ซึ่งต้องตอบเร็ว
 *  (ถ้าโควตาหมดแล้วรอตาม Google หลายรอบ ผู้ใช้จะค้างเป็นนาที)
 */
export async function embedTexts(
  texts: string[],
  opts: { attempts?: number; timeoutMs?: number } = {}
): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = texts.map(() => null);
  const base = endpoint();
  const key = process.env.AI_API_KEY;
  if (!base || !key || !texts.length) return out;
  const attempts = Math.max(1, opts.attempts ?? 4);
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 30000);

  for (let start = 0; start < texts.length; start += BATCH) {
    const slice = texts.slice(start, start + BATCH);
    // free tier จำกัด ~100 ข้อความ/นาที — ลองใหม่ได้ตาม attempts โดยรอตามที่ Google บอก
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(base + "/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify({
            model: MODEL,
            dimensions: DIMS,
            input: slice.map((t) => String(t || "").slice(0, MAX_CHARS) || "-"),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          if (response.status === 429 && attempt < attempts - 1) {
            await new Promise((r) => setTimeout(r, retryDelayMs(body, 20000)));
            continue;
          }
          console.warn(`[embed] provider ${response.status}: ${body.slice(0, 120)}`);
          break;
        }
        const json: any = await response.json();
        const data: any[] = Array.isArray(json?.data) ? json.data : [];
        data.forEach((item, i) => {
          const vec = item?.embedding ?? item;
          if (Array.isArray(vec) && vec.length) out[start + i] = vec.map(Number);
        });
        break;
      } catch (error: any) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        console.warn("[embed] เรียก embedding ไม่สำเร็จ:", error?.message || error);
      }
    }
  }
  return out;
}

export function encodeVector(vec: number[]): StoredVector {
  const f = new Float32Array(vec);
  return { d: vec.length, v: Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString("base64") };
}

export function decodeVector(value: any): Float32Array | null {
  if (!value || typeof value !== "object" || typeof value.v !== "string") return null;
  try {
    const buf = Buffer.from(value.v, "base64");
    if (!buf.byteLength || buf.byteLength % 4 !== 0) return null;
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } catch {
    return null;
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/* ---------------------------- query cache ---------------------------- */

const queryCache = new Map<string, { vec: Float32Array; at: number }>();
const QUERY_TTL = 30 * 60 * 1000;
const QUERY_MAX = 300;

/** ฝังคำถามของผู้ใช้ (แคชไว้ เพราะถามซ้ำ/ถามต่อเนื่องใช้คำเดิมบ่อย) */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  if (!embeddingsEnabled()) return null;
  const key = String(text || "").trim().slice(0, MAX_CHARS);
  if (!key) return null;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_TTL) return hit.vec;
  // ต้องเร็ว: ลองครั้งเดียว จำกัดเวลา 5 วิ — ถ้าโควตาหมดให้ถอยไปใช้ keyword/trigram ทันที
  const [vec] = await embedTexts([key], { attempts: 1, timeoutMs: 5000 }).catch(() => [null]);
  if (!vec) return null;
  const out = new Float32Array(vec);
  if (queryCache.size > QUERY_MAX) queryCache.clear();
  queryCache.set(key, { vec: out, at: Date.now() });
  return out;
}

/* ---------------------------- backfill ---------------------------- */

export async function embeddingStats() {
  const rows = await prisma.$queryRaw<{ total: number; missing: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE embedding IS NULL)::int AS missing
    FROM "MaterialChunk"`;
  const row = rows[0] || { total: 0, missing: 0 };
  return { total: Number(row.total), missing: Number(row.missing) };
}

/**
 * ฝัง chunk ที่ยังไม่มีเวกเตอร์ (สูงสุด maxChunks ต่อรอบ)
 * ทำงานเบื้องหลังได้ — ไม่บล็อกคำขอของผู้ใช้ และรองรับเนื้อหาใหม่จาก Classroom อัตโนมัติ
 */
export async function backfillEmbeddings(maxChunks = 200): Promise<{ embedded: number; remaining: number }> {
  if (!embeddingsEnabled()) return { embedded: 0, remaining: -1 };
  const rows = await prisma.$queryRaw<{ id: string; content: string }[]>`
    SELECT id, content FROM "MaterialChunk"
    WHERE embedding IS NULL
    ORDER BY "createdAt" ASC
    LIMIT ${maxChunks}`;
  if (!rows.length) return { embedded: 0, remaining: 0 };

  let embedded = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vecs = await embedTexts(slice.map((r) => r.content));
    if (vecs.every((v) => !v)) {
      // โควตารายวันหมด/ผู้ให้บริการล่ม — หยุดรอบนี้แล้วรอรอบถัดไป (worker เรียกทุก 10 นาที)
      console.warn("[embed] ผู้ให้บริการไม่พร้อม (อาจหมดโควตา) — หยุดรอบนี้ จะลองใหม่รอบถัดไป");
      break;
    }
    for (let j = 0; j < slice.length; j++) {
      const vec = vecs[j];
      if (!vec) continue;
      const payload = JSON.stringify(encodeVector(vec));
      await prisma.$executeRaw`UPDATE "MaterialChunk" SET embedding = ${payload}::jsonb WHERE id = ${slice[j].id}`;
      embedded++;
    }
    // เว้นจังหวะระหว่างชุด — free tier จำกัดจำนวนคำขอต่อนาที
    if (i + BATCH < rows.length) await new Promise((r) => setTimeout(r, 700));
  }
  const { missing } = await embeddingStats();
  return { embedded, remaining: missing };
}

/**
 * ฝังเวกเตอร์ให้ chunk ของ "ไฟล์เดียว" ทันทีหลังอัปโหลด
 * เพื่อให้ไฟล์ใหม่ค้นเจอด้วยความหมายได้ทันที ไม่ต้องรอ worker รอบถัดไป (10 นาที)
 * ทำงานเบื้องหลังแบบ fire-and-forget — ถ้าโควตาหมดก็ปล่อยให้ worker ตามเก็บทีหลัง
 */
export async function embedMaterial(materialId: string, maxChunks = 40): Promise<number> {
  if (!embeddingsEnabled() || !materialId) return 0;
  const rows = await prisma.$queryRaw<{ id: string; content: string }[]>`
    SELECT id, content FROM "MaterialChunk"
    WHERE "materialId" = ${materialId} AND embedding IS NULL
    ORDER BY "chunkIndex" ASC
    LIMIT ${maxChunks}`;
  if (!rows.length) return 0;
  const vecs = await embedTexts(rows.map((r) => r.content));
  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const vec = vecs[i];
    if (!vec) continue;
    const payload = JSON.stringify(encodeVector(vec));
    await prisma.$executeRaw`UPDATE "MaterialChunk" SET embedding = ${payload}::jsonb WHERE id = ${rows[i].id}`;
    embedded++;
  }
  return embedded;
}

let workerRunning = false;

/** เริ่ม worker เบื้องหลัง: เติม embedding ให้เนื้อหาใหม่เป็นระยะ */
export function startEmbeddingWorker(intervalMs = 10 * 60 * 1000) {
  if (!embeddingsEnabled() || process.env.EMBED_WORKER === "0") return;
  const tick = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      const result = await backfillEmbeddings(200);
      if (result.embedded) console.log(`[embed] เติมเวกเตอร์ ${result.embedded} chunk (ยังเหลือ ${result.remaining})`);
    } catch (error: any) {
      console.warn("[embed] worker ล้มเหลว:", error?.message || error);
    } finally {
      workerRunning = false;
    }
  };
  setTimeout(tick, 8000);
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}
