import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { prisma, requireAuth } from "../auth";
import { tidyProblem } from "../lib/tidy-problem";
import { SUBJECT_SUFFIXES, detectSubjectTag, scanTopics, gateBySubject, buildTopicPrompt, mergeTopics, topicsFromTitles, looksLikeAnnouncement, stripProgrammingTopics, TOPIC_CATALOG } from "./topics";
import { sortByTitle } from "../lib/natural-sort";
import { cosine, decodeVector, embedQuery } from "../lib/embeddings";

const router = Router();

/* ------------------------------------------------------------------ */
/* ตัวช่วย LLM (ใช้กับ Gemini ผ่าน OpenAI-compatible endpoint)           */
/* ------------------------------------------------------------------ */

// หมายเหตุ: endpoint แบบ OpenAI-compatible ของ Gemini ไม่รองรับ response_format
// จึงต้องสั่งขอ JSON ใน prompt แล้ว parse เอง

/** เรียกแบบ stream — ส่งข้อความทยอยกลับไปให้ผู้ใช้เห็นทันที */
async function llmStream(
  model: string,
  messages: { role: string; content: string }[],
  onChunk: (delta: string) => void,
  opts?: { timeoutMs?: number; temperature?: number }
): Promise<string> {
  const endpoint = process.env.AI_BASE_URL?.replace(/\/$/, "");
  const key = process.env.AI_API_KEY;
  if (!endpoint || !key) return "";
  const response = await fetch(endpoint + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model, temperature: opts?.temperature ?? 0.4, stream: true, messages }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 30000),
  });
  if (!response.ok || !response.body) {
    const t = await response.text().catch(() => "");
    const err: any = new Error("AI provider error " + response.status + ": " + t.slice(0, 160));
    err.status = response.status;
    throw err;
  }
  const reader = (response.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content || "";
        if (delta) { full += delta; onChunk(delta); }
      } catch { /* ข้ามบรรทัดที่ parse ไม่ได้ */ }
    }
  }
  return full;
}

/* โมเดลสำรองที่มีจริง (ตรวจจาก ListModels ของ Google)
   วัดจริง:3.5-flash-lite เร็วสุด ~1.2s · 3.5-flash ~3.6s · 3.6-flash ~5.4s
   3.8-flash และ 3.7-flash มัก 429/timeout จึงไม่ใส่ไว้ */
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"];
async function llmOnce(
  model: string,
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; json?: boolean; timeoutMs?: number }
) {
  const endpoint = process.env.AI_BASE_URL?.replace(/\/$/, "");
  const key = process.env.AI_API_KEY;
  if (!endpoint || !key) return null;
  const response = await fetch(endpoint + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.4,
      messages,
    }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 90000),
  });
  if (!response.ok) {
    const t = await response.text();
    const err: any = new Error("AI provider error " + response.status + ": " + t.slice(0, 200));
    err.status = response.status;
    throw err;
  }
  const body: any = await response.json();
  return String(body?.choices?.[0]?.message?.content || "").trim() || null;
}

/** เรียก LLM พร้อมลองซ้ำและสลับโมเดลสำรองเมื่อคิวแน่น (503/429)
 *  deadline = เวลาสิ้นสุด (epoch ms) — กันคำขอค้างนานเป็นนาทีจน tunnel/proxy ตัดการเชื่อมต่อ */
async function llm(
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; json?: boolean; model?: string; deadline?: number }
) {
  const primary = opts?.model || process.env.AI_MODEL || "gemini-3.5-flash-lite";
  const models = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
  let lastError: any = null;
  for (let i = 0; i < models.length; i++) {
    const remaining = opts?.deadline ? opts.deadline - Date.now() : 90000;
    if (remaining < 3000) break;
    try {
      const raw = await llmOnce(models[i], messages, {
        temperature: opts?.temperature,
        json: opts?.json,
        // 20 วิ/โมเดล: โมเดลที่ค้างจะไม่กินเวลาจนผู้ใช้หมด patience ก่อนได้ลองตัวสำรอง
        timeoutMs: Math.min(20000, remaining),
      });
      if (!raw) return null;
      if (!opts?.json) return raw;
      // ดึง JSON ออกจากข้อความ (บางครั้งโมเดลจะห่อด้วย ``` หรือมีข้อความนำหน้า)
      const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      try { return JSON.parse(cleaned); } catch {
        // โมเดลบางครั้งตอบเป็น array เปล่า -> ห่อให้เป็น { problems: [...] }
        try {
          if (cleaned.startsWith("[")) return { problems: JSON.parse(cleaned) };
        } catch { /* ignore */ }
        const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
        if (s >= 0 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { /* ignore */ } }
        lastError = new Error("AI ตอบไม่ใช่ JSON"); continue;
      }
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status);
      const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      const transient = isTimeout || [408, 429, 500, 502, 503, 504].includes(status);
      console.warn(`[llm] ${models[i]} ล้มเหลว (${error?.name || status || "?"})${transient ? " — ชั่วคราว ลองต่อ" : ""}`);
      if (!transient) break;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError || new Error("เรียก AI ไม่สำเร็จ");
}

/* ------------------------------------------------------------------ */
/* ระดับความยาก                                                       */
/* ------------------------------------------------------------------ */

type Difficulty = "normal" | "high" | "deep";
const DIFFICULTY: Record<Difficulty, { label: string; instruction: string }> = {
  normal: {
    label: "ปกติ",
    instruction: "อธิบายระดับพื้นฐาน ใช้ภาษาง่าย ยกตัวอย่างจากเนื้อหาที่มี และสรุปเป็น bullet สั้นๆ",
  },
  high: {
    label: "สูง",
    instruction: "อธิบายระดับมัธยมศึกษา เจาะลึกเป็นขั้นตอน อ้างอิงหลักการและพิสูจน์ และชี้จุดที่นักเรียนมักพลาด",
  },
  deep: {
    label: "เจาะลึก",
    instruction: "อธิบายเชิงลึกเทียบเคียงขั้นสูง วิเคราะห์ edge case และข้อจำกัดของแต่ละแนวคิด พร้อมตัวอย่างคำนวณ",
  },
};

/* ------------------------------------------------------------------ */
/* โหมดการช่วยเหลือ — เลือกจากปุ่มในช่องแชท                              */
/* ------------------------------------------------------------------ */

type AskMode = "explain" | "diagram" | "code" | "steps" | "vocab" | "grammar" | "case" | "compare" | "howto";

const MODES: Record<AskMode, { label: string; hint: string; instruction: string }> = {
  howto: {
    label: "ทำตามขั้นตอน",
    hint: "สลายเป็นขั้น ๆ",
    instruction: "แสดงขั้นตอนการทำงานทีละขั้นในรูปแบบที่ทำตามได้จริง ระบุผลลัพธ์ที่คาดว่าจะได้ในแต่ละขั้น",
  },
  steps: {
    label: "ทำโจทย์ทีละขั้น",
    hint: "สลายเป็นขั้น ๆ",
    instruction: "แสดงวิธีทำเป็นขั้นตอนที่ตรวจสอบได้ ทีละบรรทัด อธิบายเหตุผลของแต่ละขั้น",
  },
  vocab: {
    label: "คำศัพท์",
    hint: "คำศัพท์ + ความหมาย",
    instruction: "แสดงคำศัพท์เป็นตาราง คำ + ความหมาย + พาร์ทของคำ + ประโยคตัวอย่างที่ใช้จริง",
  },
  grammar: {
    label: "ไวยากรณ์",
    hint: "โครงสร้างประโยค",
    instruction: "อธิบายโครงสร้างไวยากรณ์เป็นตาราง เทียบกฎที่สับสนบ่อย พร้อมตัวอย่างที่ถูกและผิด",
  },
  case: {
    label: "กรณีศึกษา",
    hint: "วิเคราะห์กรณีศึกษา",
    instruction: "ยกกรณีตัวอย่างจากเนื้อหาที่ให้มา แล้ววิเคราะห์ประเด็นสำคัญพร้อมเหตุผลและข้อสรุปอย่างเป็นระบบ",
  },
  compare: {
    label: "เปรียบเทียบ",
    hint: "เทียบข้อดีข้อเสีย",
    instruction: "เปรียบเทียบเป็นตาราง ช่องเทียบ ข้อดี ข้อเสีย และตัวอย่างประกอบให้ครบทุกช่อง",
  },
  explain: {
    label: "อธิบาย",
    hint: "อธิบายหัวข้อให้เข้าใจง่าย",
    instruction: "อธิบายแบบผู้สอนที่เข้าใจนักเรียน เริ่มจากแนวคิดแล้วค่อย ๆ ไปตัวอย่าง",
  },
  diagram: {
    label: "ผังภาพ",
    hint: "วาด flowchart / ผังงาน",
    instruction: [
      "วาด flowchart ของโจทย์นี้เป็น Mermaid เท่านั้น ห้ามเขียนอธิบายลอย ๆ",
      "รูปแบบ: ```mermaid แล้วขึ้นบรรทัดใหม่ เขียน flowchart TD",
      "ใช้ได้เฉพาะ: จุดเริ่มต้น A[ข้อความ] / กระบวนการ B(ข้อความ) / รับ-แสดงผล C[/ข้อความ/] / ตัดสิน D{คำถาม} / ปลายทาง E([จบ])",
      "เชื่อมด้วย --> และใส่ป้ายกำกับบนเส้นด้วย -->|ใช่| เท่านั้น",
      "ห้ามใช้ subgraph, classDef, style, หรือไอคอน",
      "ใส่ <br/> ในป้ายกล่องได้ถ้ายาวเกิน 2 บรรทัด",
    ].join(" "),
  },
  code: {
    label: "โค้ด",
    hint: "เขียนโค้ดใช้ได้จริง",
    instruction: "เขียนโค้ดที่รันได้จริง ใส่ในกล่อง ``` พร้อมชื่อภาษา อธิบายเป็นคอมเมนต์ภาษาไทยในโค้ด ห้ามมีคำอธิบายนอกกล่อง",
  },
};

/** ตรวจค่าที่ส่งมาว่าถูกต้องไหม กันพิสูจน์ใครส่งค่าแปลกๆ */
type Speed = "fast" | "balanced" | "thorough";
// โมเดล "lite" ตอบเร็วและเสถียรกว่าในโควตาฟรี (flash/3.6 บางช่วงค้างเกิน 30 วิ ทำให้ผู้ใช้เห็นค้าง/หลุด)
// ตั้งค่าที่ต้องการผ่าน .env: AI_MODEL / AI_FAST_MODEL / AI_DEEP_MODEL
const SPEED: Record<Speed, { label: string; model: string; instruction: string; temperature: number }> = {
  fast: { label: "เร็ว", model: process.env.AI_FAST_MODEL || "gemini-3.5-flash-lite", instruction: "ตอบสั้นที่สุด ไม่อธิบายเพิ่ม", temperature: 0.3 },
  balanced: { label: "ปกติ", model: process.env.AI_MODEL || "gemini-3.5-flash-lite", instruction: "ตอบกระชับ ครบ ไม่เยิ่นเย้อ", temperature: 0.5 },
  thorough: { label: "ละเอียด", model: process.env.AI_DEEP_MODEL || "gemini-3.5-flash-lite", instruction: "อธิบายละเอียดเป็นขั้นตอน พร้อมตัวอย่าง", temperature: 0.7 },
};
function pickMode(v: any): AskMode { return (typeof v === "string" && v in MODES ? v : "explain") as AskMode; }
function pickDifficulty(v: any): Difficulty { return (["normal", "high", "deep"].includes(v) ? v : "normal") as Difficulty; }
function pickSpeed(v: any): Speed { return (typeof v === "string" && v in SPEED ? v : "balanced") as Speed; }

/* ------------------------------------------------------------------ */
/* ค้นเนื้อหาจาก Knowledge Base ของวิชา                                  */
/* ------------------------------------------------------------------ */

function tokenize(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^฀-๿\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((x) => x.length > 1);
}

/** ค้นเนื้อหาจาก Knowledge Base: ผสม "คำตรงกัน" กับ "ความหมายใกล้กัน" (embedding)
 *  - keyword: เดิม (นับคำที่ตรง + prefix ไทย) — แม่นเมื่อผู้ใช้ใช้คำเดียวกับไฟล์
 *  - semantic: cosine ระหว่างเวกเตอร์คำถามกับเวกเตอร์ chunk — แม่นเมื่อใช้คำต่างกัน
 *  ถ้ายังไม่มีเวกเตอร์ (เพิ่งซิงก์/กำลัง backfill) จะถอยไปใช้ keyword อย่างเดียวโดยอัตโนมัติ
 */
async function retrieve(subjectId: string, userId: string, query: string, limit = 8) {
  const [materials, qvec] = await Promise.all([
    prisma.material.findMany({
      where: { subjectId, userId, status: "COMPLETED" },
      include: { chunks: true },
    }),
    embedQuery(query).catch(() => null),
  ]);
  const terms = new Set(tokenize(query));
  const scored = materials.flatMap((m) =>
    m.chunks.map((chunk) => {
      const words = tokenize(chunk.content);
      let hits = 0;
      for (const w of words) if (terms.has(w)) hits++;
      // บูรณ์คำไทยแบบเดียว: "วนธรรมดา" ควรเจอคำว่า "วน"
      if (terms.size) {
        for (const t of terms) {
          if (t.length > 3 && chunk.content.toLowerCase().includes(t.slice(0, 3))) hits += 0.4;
        }
      }
      const keyword = Math.min(1, hits / Math.max(3, Math.min(8, terms.size)));
      const vector = decodeVector(chunk.embedding);
      const semantic = qvec && vector ? cosine(qvec, vector) : 0;
      const score = qvec && vector ? 0.55 * semantic + 0.45 * keyword : keyword;
      return { m, chunk, keyword, semantic, score, hasVector: !!vector };
    })
  );
  scored.sort((a, b) => b.score - a.score);

  const semMode = !!qvec && scored.some((x) => x.hasVector);
  const picked = scored
    .filter((x) => (semMode ? x.semantic >= 0.55 || x.keyword >= 0.5 : x.score > 0))
    .slice(0, limit);

  // ดึง chunk ก่อน/หลังของผลที่ติดมาด้วย — คำอธิบายในสไลด์มักต่อเนื่องกันคนละหน้า
  const byMaterial = new Map<string, any[]>();
  for (const m of materials) byMaterial.set(m.id, [...m.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex));
  const ranked: typeof picked = [];
  const seen = new Set<string>();
  for (const hit of picked) {
    const list = byMaterial.get(hit.m.id) || [];
    const idx = list.findIndex((c) => c.id === hit.chunk.id);
    for (const offset of [0, -1, 1]) {
      const chunk = list[idx + offset];
      if (!chunk || seen.has(chunk.id)) continue;
      seen.add(chunk.id);
      ranked.push(offset === 0 ? hit : { ...hit, chunk, score: hit.score * 0.9 });
    }
  }
  return { materials, ranked: ranked.slice(0, limit + 4), semantic: semMode };
}

function toSources(ranked: { m: any; chunk: any }[]) {
  // ต้องเรียง 1:1 กับหลักฐาน [1] [2] ... ที่ส่งให้โมเดล ไม่งั้นเลขอ้างอิงในคำตอบจะชี้ผิดไฟล์
  return ranked.slice(0, 6).map((r) => ({
    materialId: r.m.id,
    title: r.m.title,
    fileName: r.m.fileName,
    mimeType: r.m.mimeType,
    url: r.m.externalUrl,
    sourceLabel: r.m.sourceLabel,
    updatedAt: r.m.externalUpdatedAt,
    chunk: r.chunk.chunkIndex + 1,
    excerpt: String(r.chunk.content || "").slice(0, 260),
    hasFile: !!r.m.filePath,
  }));
}

/* ------------------------------------------------------------------ */
/* 1) ถาม–ตอบ — ยึดเนื้อหาในวิชาเป็นหลักฐาน แต่ถ้าไม่มีก็อธิบายต่อได้      */
/* ------------------------------------------------------------------ */

/** ประวัติบทสนทนาที่ส่งกลับมาเพื่อให้ถามต่อเนื่องได้เหมือน ChatGPT */
type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 1500;

function parseHistory(raw: any): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw) {
    if (!item) continue;
    const role =
      item.role === "assistant" || item.role === "ai" || item.role === "model"
        ? "assistant"
        : item.role === "user" || item.role === "me"
          ? "user"
          : null;
    const content = String(item.content ?? item.text ?? "").replace(/\s+/g, " ").trim();
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, MAX_HISTORY_CHARS) });
  }
  return out.slice(-MAX_HISTORY_TURNS);
}

/** ข้อความทักทาย/คุยเล่นทั่วไป — ให้ AI คุยตอบได้ตามมารยาท ไม่ต้องยัดเนื้อหาวิชา */
function isCasualChat(q: string): boolean {
  const t = String(q || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return false;
  const head = t.slice(0, 40).toLowerCase();
  // ทักทายแบบพิมพ์ผิด/พิมพ์เพี้ยนก็ยังจับได้ เช่น "สวีสดีสาจารย์" (ตั้งใจพิมพ์ "สวัสดีอาจารย์")
  const GREETING = /(สว[ัีะ]?[สซ]?ดี|หวัดดี|ดีครับ|ดีค่ะ|ดีคะ|อรุณสวัสดิ์|ราตรีสวัสดิ์|ฝันดี|\b(?:hello|hi|hey|yo)\b)/i;
  const THANKS = /(ขอบคุณ|ขอบใจ|เข้าใจแล้ว|โอเค|บ๊ายบาย|ลาก่อน|แล้วเจอกัน|สบายดี|\b(?:thanks|thank you|ok|okay)\b)/i;
  if (!GREETING.test(head) && !THANKS.test(t)) return false;
  // ถ้ามีคำถาม/คำสั่งเชิงเนื้อหา = ไม่ใช่คุยเล่น ให้ไปทางคำตอบตามเนื้อหาปกติ
  const STUDY = /(\?|อธิบาย|คืออะไร|หมายถึง|ทำไม|ทําไม|ยังไง|อย่างไร|ทำอย่างไร|สรุป|เปรียบเทียบ|โค้ด|ตัวอย่าง|ขั้นตอน|นิยาม|โจทย์|แบบฝึก|ไม่เข้าใจ|ช่วย|สอน|quiz|สอบ|การบ้าน|บทที่|ไฟล์)/i;
  if (STUDY.test(t)) return false;
  return true;
}

/** คำถามต่อเนื่องที่อ้างถึงเรื่องเดิม ต้องค้นเนื้อหาด้วยบริบทเดิมด้วย ไม่ใช่ค้นแค่ประโยคสั้น ๆ */
function retrievalQuery(question: string, history: ChatTurn[]) {
  const lastUser = [...history].reverse().find((h) => h.role === "user")?.content || "";
  if (!lastUser) return question;
  const contextual =
    question.length <= 40 ||
    /(มัน|อันนี้|อันนั้น|ที่พูด|เมื่อกี้|ต่อ|อีก|ตัวอย่าง|ขยาย|อธิบายเพิ่ม|แล้ว|ทำไม|ยังไง)/i.test(question);
  if (!contextual) return question;
  return (lastUser.slice(0, 200) + " " + question).trim();
}

/** คำตอบสำรองเมื่อผู้ให้บริการ AI ใช้งานไม่ได้ (โควตาเต็ม/เน็ตหลุด)
 *  ต้องบอกผู้ใช้ตรง ๆ ว่าเป็นข้อความจากไฟล์ ไม่ใช่คำตอบที่ AI เรียบเรียงแล้ว */
function fallbackAnswer(ranked: { m: any; chunk: any }[], casual: boolean, subjectName: string) {
  if (casual) return "สวัสดีครับ! ผมครู AI ของวิชา " + subjectName + " วันนี้ให้ช่วยเรื่องอะไรดี";
  if (!ranked.length) return "ยังไม่พบเนื้อหาที่ตรงกับคำถามนี้ ลองถามด้วยชื่อหัวข้อหรือคำสำคัญที่อยู่ในไฟล์ครับ";
  const top = ranked
    .slice(0, 3)
    .map((r, i) => `[${i + 1}] ${r.m.title}\n${String(r.chunk.content).replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n\n");
  return "ตอนนี้ผู้ให้บริการ AI ไม่พร้อมชั่วคราว (โควตารายวันเต็ม) — นี่คือเนื้อหาที่เกี่ยวข้องจากไฟล์ของคุณ:\n\n" + top + "\n\nลองถามอีกครั้งภายหลังเพื่อรับคำอธิบายฉบับเต็มครับ";
}

/** สร้าง prompt ชุดเดียวกัน ใช้ได้ทั้งแบบ stream และแบบรอผลเต็ม */
function buildPrompt(
  subject: { name: string; description?: string | null },
  question: string,
  mode: AskMode,
  difficulty: Difficulty,
  speed: Speed,
  ranked: { m: any; chunk: any }[],
  materials: any[],
  history: ChatTurn[] = []
) {
  const prior = history.map((h) => ({ role: h.role, content: h.content }));

  // ข้อความทักทาย/คุยเล่น → โหมดสนทนา (ไม่อ้างอิงไฟล์ ไม่บังคับเข้าเนื้อหา)
  if (isCasualChat(question)) {
    const chatSystem =
      'คุณคือ "ครู AI" ผู้ช่วยการเรียนของมหาวิทยาลัย (ดูแลวิชา ' + subject.name + ') พูดคุยเป็นธรรมชาติเหมือน ChatGPT ตอบภาษาไทยเป็นกันเองและสั้น\n' +
      "1) ตอบสิ่งที่อีกฝ่ายพูดจริง ๆ ก่อน เช่น ทักทายก็ทักทายกลับ ขอบคุณก็รับคำขอบคุณ\n" +
      "2) ข้อความสั้น → ตอบสั้น 1-2 ประโยค ไม่ต้องขึ้นหัวข้อ ไม่ต้องยัดเนื้อหาวิชา ไม่ต้องปิดท้ายด้วยคำถามทุกครั้ง\n" +
      "3) ใช้ประวัติบทสนทนาก่อนหน้า ถ้าอีกฝ่ายอ้างถึงสิ่งที่คุยกันไว้ ให้ตอบต่อเนื่องอย่างสม่ำเสมอ\n" +
      "4) ถ้าอีกฝ่ายเริ่มถามเรื่องเรียน/เนื้อหา ค่อยสลับไปช่วยเรื่องวิชานั้นอย่างเต็มที่\n" +
      "5) ห้ามขึ้นต้นว่า 'ความรู้ทั่วไป' และห้ามใช้บทตอบสำเร็จรูปซ้ำ ๆ";
    return {
      messages: [{ role: "system", content: chatSystem }, ...prior, { role: "user", content: question }],
      grounded: false,
      casual: true,
    };
  }

  // หลักฐาน "แข็ง" พอหรือไม่ — ถ้าความหมายใกล้เคียงต่ำมาก แปลว่าเนื้อหาที่เจอไม่เกี่ยวกับคำถามจริง
  // ปล่อยให้ตอบจากความรู้ทั่วไปพร้อมกำกับ ดีกว่าปฏิเสธทั้งคำถาม (ผู้ใช้จะรู้สึกว่า AI ไม่เก่ง)
  const top: any = ranked[0];
  const strong = !!top && ((Number(top.semantic) || 0) >= 0.6 || (Number(top.keyword) || 0) >= 0.5);
  const grounded = ranked.length > 0 && strong;
  const evidence = grounded ? ranked.slice(0, 6) : [];
  const context = grounded
    ? evidence
        .map(
          (r, i) =>
            `[${i + 1}] ${r.m.title}${r.chunk ? ` (ตอนที่ ${r.chunk.chunkIndex + 1})` : ""}\n${String(r.chunk.content).slice(0, 1000)}`
        )
        .join("\n\n")
    : materials.slice(0, 12).map((m) => `- ${m.title}`).join("\n");

  const system =
    "คุณคืออาจารย์ AI ของมหาวิทยาลัย คุยกับนักศึกษาเป็นภาษาไทยอย่างเป็นธรรมชาติและตรงประเด็น\n" +
    (grounded
      ? "1) ใช้หลักฐานที่ให้มาเป็นหลัก ห้ามแต่งข้อมูลที่ไม่มีในหลักฐาน\n"
      : "1) คำถามนี้ไม่ตรงกับเนื้อหาในไฟล์ที่ซิงก์มา — ห้ามปฏิเสธ ให้ใช้ความรู้ทั่วไปของสาขานั้นอธิบายต่อ โดยยึดว่าวิชานี้สอนเรื่องอะไร\n") +
    "2) ตอบคำถามที่ถามจริง ๆ เป็นประโยคแรก ไม่ต้องเกริ่นนำ ไม่ต้องทวนคำถาม\n" +
    "3) ถ้าคำถามสั้น/ง่าย ให้ตอบสั้นกระชับ 2-5 ประโยคก่อน แล้วค่อยขยายเมื่อถูกถามต่อ — ไม่ต้องจัดหัวข้อทุกครั้ง\n" +
    "4) ใช้ bullet/ตาราง/ขั้นตอนเมื่อช่วยให้เข้าใจง่ายเท่านั้น และถ้าอธิบายขั้นตอนการทำงานจึงค่อยวาด flowchart ในกล่อง ```\n" +
    "5) ใช้ประวัติบทสนทนาก่อนหน้าให้ต่อเนื่องเหมือนคุยกับคนคนเดิม — ห้ามอธิบายซ้ำสิ่งที่เพิ่งตอบไปแล้ว\n" +
    (grounded ? "" : "6) ถ้าตอบจากความรู้ทั่วไป (ไม่ได้อยู่ในไฟล์) ให้ขึ้นบรรทัดแรกว่า 'ความรู้ทั่วไป (ไม่ได้อยู่ในไฟล์ที่ซิงก์)'\n") +
    "7) ถ้าเกี่ยวกับการเขียนโปรแกรม ให้ใส่โค้ดในกล่อง ``` พร้อมชื่อภาษา แล้วอธิบายเฉพาะจุดสำคัญ\n" +
    "8) ไม่ต้องปิดท้ายด้วยคำถามทุกครั้ง — ถ้าจะถามต่อ ให้ถามเฉพาะเมื่อมีประโยชน์จริง\n" +
    (grounded
      ? "9) ทุกข้อความที่ดึงมาจากหลักฐาน ให้ต่อท้ายด้วยเลขอ้างอิงในวงเล็บเหลี่ยม เช่น [1] หรือ [2][3] โดยใช้เลขเดียวกับหลักฐานที่ให้มาเท่านั้น (ห้ามอ้างเลขที่ไม่มีอยู่) ถ้าหลักฐานมีบางส่วน ให้ตอบส่วนที่มีก่อนแล้วบอกว่าส่วนที่เหลือไม่มีในไฟล์ — ไม่ต้องปฏิเสธทั้งคำถาม\n"
      : "") +
    "โหมดที่สั่ง: " + MODES[mode].instruction + "\n" +
    "ระดับความยาก: " + DIFFICULTY[difficulty].instruction + "\n" +
    "สไตล์การตอบ: " + SPEED[speed].instruction;

  const user =
    "ชื่อวิชา: " + subject.name + "\n" +
    (subject.description ? "รายละเอียดวิชา: " + subject.description + "\n" : "") +
    (grounded ? "หลักฐานจากไฟล์ในวิชา:\n" + context : "หัวข้อที่มีอยู่ในวิชานี้:\n" + context) +
    "\n\nคำถาม:\n" + question;

  return {
    messages: [{ role: "system", content: system }, ...prior, { role: "user", content: user }],
    grounded,
    casual: false,
  };
}

/* ------------------------------------------------------------------ */
/*  หัวข้อสอบของวิชา — สแกนจากเอกสาร + งานที่ส่ง แล้วให้ AI คัดเหลือที่เกี่ยว   */
/* ------------------------------------------------------------------ */

const topicCache = new Map<string, { at: number; data: any }>();
const TOPIC_TTL = 6 * 60 * 60 * 1000;

/** สร้างหัวข้อของวิชา: สแกนเอกสาร+งานที่ส่ง -> กรองตามสาขา -> ให้ AI คัด + เติม */
export async function buildSubjectTopics(
  userId: string,
  subjectId: string,
  subjectName: string,
  refresh = false,
) {
  const hit = topicCache.get(subjectId);
  if (!refresh && hit && Date.now() - hit.at < TOPIC_TTL) return hit.data;

  // ดึงมากกว่าเดิมแล้วค่อยกรองประกาศออก เพราะประกาศกินสัดส่วนของ take: 40 เยอะ
  const materials = (await prisma.material.findMany({
    where: { subjectId, status: "COMPLETED" },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { title: true, textContent: true },
  }))
    .filter((m) => !looksLikeAnnouncement(m.title))
    .slice(0, 40);
  const submissions = await prisma.submission.findMany({
    where: { subjectId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { title: true, textContent: true },
  });

  // 1) นับคำจากเอกสาร + งานที่ส่ง
  const scanned = gateBySubject(
    TOPIC_CATALOG,
    subjectName,
    scanTopics([
      ...materials.map((m) => ({ title: m.title, text: m.textContent, kind: "material" as const })),
      ...submissions.map((s) => ({ title: s.title + " (งานที่ส่ง)", text: s.textContent, kind: "submission" as const })),
    ]),
  );

  if (!scanned.length && !materials.length) {
    const empty = { subject: { id: subjectId, name: subjectName }, topics: [], scannedCount: 0, source: "empty" };
    topicCache.set(subjectId, { at: Date.now(), data: empty });
    return empty;
  }

  // 2) ให้ AI ตัดสินใจสุดท้ายว่าอะไรเกี่ยวจริง + เติมหัวข้อเฉพาะวิชา
  let aiTopics: any[] | null = null;
  const content =
    materials.slice(0, 20).map((m) => `- ${m.title}\n  ${String(m.textContent || "").replace(/\s+/g, " ").slice(0, 260)}`).join("\n") +
    (submissions.length
      ? "\n\n[งานที่นักเรียนส่ง]\n" +
        submissions.slice(0, 6).map((s) => `- ${s.title}\n  ${String(s.textContent || "").replace(/\s+/g, " ").slice(0, 260)}`).join("\n")
      : "");
  try {
    const r: any = await llm(buildTopicPrompt(subjectName, scanned, content.slice(0, 9000)), { json: true, temperature: 0.2 });
    if (r && Array.isArray(r.topics) && r.topics.length) aiTopics = r.topics.slice(0, 14);
  } catch (error) {
    console.warn("วิเคราะห์หัวข้อไม่สำเร็จ ใช้ผลสแกนคำแทน", String(error));
  }

  // 3) สำรอง: ถ้า AI ใช้ไม่ได้ หรือผลลัพธ์แย่เกินไป ให้ดึงหัวข้อจากชื่อไฟล์จริงแทน
  // (TOPIC_CATALOG เอียงสายคอมฯ วิชาอื่นจะได้หัวข้อว่างถ้าพึ่ง AI อย่างเดียว)
  // AI ก็แต่งชื่อหัวข้อขึ้นเองได้ ("ประกาศ...", "การสอบกลางภาค") ต้องกรองออกเหมือนกัน
  let finalTopics = mergeTopics(scanned, aiTopics).filter((t: any) => !looksLikeAnnouncement(String(t.label || t.title || "")));
  let source: string = aiTopics ? "ai+scan" : "scan";
  // ถ้า AI ใช้ไม่ได้ (429/503) ต้องดึงหัวข้อจากชื่อไฟล์จริงเสริม "เสมอ" ไม่ใช่แค่ตอนหัวข้อน้อยกว่า 3
  // เพราะ TOPIC_CATALOG เอียงสายคอมฯ: วิชาทักษะดิจิทัลจะได้ "แสดงผลด้วย printf",
  // "ทางเลือก 2 ทาง" ซึ่งไม่เกี่ยวกับวิชาเลย แต่ตัวเลขกลับดู "พอมีหัวข้อแล้ว"
  const needTitles = !aiTopics || finalTopics.length < 3;
  if (needTitles) {
    const fromTitles = topicsFromTitles([
      ...materials.map((m) => ({ title: m.title, kind: "material" })),
      ...submissions.map((s) => ({ title: s.title, kind: "submission" })),
    ]);
    if (fromTitles.length) {
      // หัวข้อจากชื่อไฟล์ต้อง "แทรก" ไม่ใช่ถูกหัวข้อสายคอมฯ จากแคตตาล็อกบัง
// (ส่ง scanned ซ้ำอีกครั้งจะทำให้คะแนนถูกนับสองรอบและหัวข้อผิดตัวขึ้นมาก่อนเสมอ)
      // ต้องใช้ key "label" — mergeTopics อ่าน t.label (ไม่ใช่ t.title)
      // ถ้าใช้ title จะถูกข้ามทั้งหมด แล้วตกไปใช้หัวข้อสายคอมฯ จากแคตตาล็อกแทน
      finalTopics = mergeTopics(finalTopics as any, fromTitles.map((t) => ({ key: t.k, label: t.label, group: "ทั่วไป", why: t.sources.map((s) => s.title).join(", ") })));
      source = aiTopics ? "ai+titles" : "titles";
    }
  }

  // ตัดหัวข้อสายโปรแกรมออกจากวิชาที่ไม่ใช่สายคอมฯ (AI ไม่ค่อยฟัง prompt)
/* และกันไว้กรณี mergeTopics คืนค่าไม่ได้ */
finalTopics = stripProgrammingTopics(Array.isArray(finalTopics) ? finalTopics : [], subjectName);

  // ถ้าหัวข้อหายไปหลังตัดออก ให้ดึงจากชื่อไฟล์จริงเสริม
  if (!finalTopics.length) {
    const fromTitles = topicsFromTitles([
      ...materials.map((m) => ({ title: m.title, kind: "material" })),
      ...submissions.map((s) => ({ title: s.title, kind: "submission" })),
    ]);
    if (fromTitles.length) {
      finalTopics = mergeTopics([] as any, fromTitles.map((t) => ({ key: t.k, label: t.label, group: "ทั่วไป", why: t.sources.map((s) => s.title).join(", ") })));
      source = "titles";
    }
  }

  const data = {
    subject: { id: subjectId, name: subjectName },
    topics: finalTopics,
    scannedCount: scanned.length,
    source,
    generatedAt: new Date().toISOString(),
  };
  topicCache.set(subjectId, { at: Date.now(), data });
  return data;
}

router.get("/topics", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.query?.subjectId || "").trim();
    const refresh = String(req.query?.refresh || "") === "1";
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
    res.json(await buildSubjectTopics(req.user.id, subjectId, subject.name, refresh));
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});
router.post("/ask", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const question = String(req.body?.question || "").trim();
    const difficulty = pickDifficulty(req.body?.difficulty);
  // ถามว่า "ทำผังงาน" แต่โหมดยังเป็นค่าเริ่มต้น(อธิบาย) = ได้ ASCII เป็นตัวอักษร ให้สลับเป็นโหมดผังภาพให้เอง
  let mode = pickMode(req.body?.mode);
  if (mode === "explain" && /(ผังงาน|ผังภาพ|flowchart|flow\s?chart|algorithm\s*selection)/i.test(question)) mode = "diagram";
    const speed = pickSpeed(req.body?.speed);
    const history = parseHistory(req.body?.history);
    if (!subjectId || !question) return res.status(400).json({ error: "กรุณาเลือกวิชาและพิมพ์คำถาม" });

    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    const casual = isCasualChat(question);
    const { materials, ranked } = await retrieve(subjectId, req.user.id, retrievalQuery(question, history));
    // ข้อความทักทาย/คุยเล่น ไม่ต้องมีเนื้อหาวิชาก็คุยได้
    if (!materials.length && !casual) {
      return res.json({ grounded: false, usedModel: false, casual: false, answer: "วิชานี้ยังไม่มีเนื้อหาใน Knowledge Base กรุณาซิงก์จาก Google Classroom ก่อน", sources: [] });
    }

    const { messages, grounded } = buildPrompt(subject, question, mode, difficulty, speed, ranked, materials, history);
    let answer: string | null = null;
    try {
      answer = await llm(messages, { temperature: SPEED[speed].temperature, model: SPEED[speed].model, deadline: Date.now() + 45000 });
    } catch (error) {
      console.warn("AI provider ใช้ไม่ได้ ใช้การค้นเนื้อหาแทน", String(error));
    }

    if (!answer) {
      answer = fallbackAnswer(ranked, casual, subject.name);
    }

    res.json({
      grounded,
      casual,
      usedModel: !!answer && ranked.length > 0,
      mode, difficulty, speed,
      answer,
      sources: casual || !grounded ? [] : toSources(ranked),
      evidenceCount: ranked.length,
      materialCount: materials.length,
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* ------------------------------------------------------------------ */
/* 1b) ถาม–ตอบแบบ Stream — ข้อความทยอยขึ้น เห็นผลใน 1-3 วินาที        */
/* ------------------------------------------------------------------ */

const answerCache = new Map<string, { answer: string; sources: any[]; grounded: boolean; at: number }>();
const CACHE_MS = 15 * 60 * 1000;

router.post("/ask/stream", requireAuth(), async (req: any, res) => {
  const subjectId = String(req.body?.subjectId || "").trim();
  const question = String(req.body?.question || "").trim();
  const difficulty = pickDifficulty(req.body?.difficulty);
  let mode = pickMode(req.body?.mode);
  // ถามว่า "ทำผังงาน" แต่โหมดยังเป็นค่าเริ่มต้น(อธิบาย) = ได้ ASCII เป็นตัวอักษร ให้สลับเป็นโหมดผังภาพให้เอง
  if (mode === "explain" && /(ผังงาน|ผังภาพ|flowchart|flow\s?chart|algorithm\s*selection)/i.test(question)) mode = "diagram";
  const speed = pickSpeed(req.body?.speed);
  const history = parseHistory(req.body?.history);
  const casual = isCasualChat(question);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  let closed = false;
  res.on("close", () => { closed = true; });
  const send = (event: string, data: any) => {
    if (closed || res.writableEnded) return false;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      closed = true;
      return false;
    }
  };
  // heartbeat: ระหว่างรอโมเดลตัวแรกอาจเงียบเกิน 15 วิ ทำให้ proxy/tunnel ตัดการเชื่อมต่อ
  // (อาการที่ผู้ใช้เห็น: คำตอบหายกลางทาง / ขึ้นว่าเชื่อมต่อไม่สำเร็จ)
  const heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15000);
  const stopHeartbeat = () => clearInterval(heartbeat);
  res.on("close", stopHeartbeat);

  try {
    if (!subjectId || !question) return send("error", { error: "กรุณาเลือกวิชาและพิมพ์คำถาม" }), res.end();
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
    if (!subject) return send("error", { error: "ไม่พบวิชา" }), res.end();

    // ใส่ประวัติใน cache key ด้วย — ถามต่อเนื่องบริบทต่างกันต้องไม่ได้คำตอบเดิม
    const historyKey = crypto
      .createHash("sha1")
      .update(history.map((h) => h.role + ":" + h.content).join("\n"))
      .digest("hex")
      .slice(0, 12);
    const cacheKey = `${subjectId}|${difficulty}|${mode}|${speed}|${casual ? "casual" : "study"}|${question.toLowerCase()}|${historyKey}`;
    const hit = answerCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      send("sources", { sources: hit.sources });
      send("delta", { text: hit.answer });
      send("done", { usedModel: true, grounded: hit.grounded, casual, cached: true });
      return res.end();
    }

    const { materials, ranked } = await retrieve(subjectId, req.user.id, retrievalQuery(question, history));
    // ข้อความทักทาย/คุยเล่น ไม่ต้องมีเนื้อหาวิชาก็คุยได้
    if (!materials.length && !casual) {
      send("delta", { text: "วิชานี้ยังไม่มีเนื้อหาใน Knowledge Base กรุณาซิงก์จาก Google Classroom ก่อน" });
      return send("done", { usedModel: false, grounded: false, casual: false }), res.end();
    }

    const { messages, grounded } = buildPrompt(subject, question, mode, difficulty, speed, ranked, materials, history);
    const sources = casual || !grounded ? [] : toSources(ranked);
    send("sources", { sources });

    // เรียงจากโมเดลที่เร็ว/เสถียรก่อน — ตัวที่ค้างจะถูกตัดที่ 20 วิ แล้วไปตัวถัดไปทันที
    const models = Array.from(
      new Set([SPEED[speed].model, process.env.AI_MODEL || "gemini-3.5-flash-lite", ...FALLBACK_MODELS])
    );
    let full = "";
    let usedModel = false;
    // เวลารวมของทั้งคำขอ: ไม่ปล่อยให้ค้างข้ามนาที (tunnel ตัดการเชื่อมต่อก่อนที่ผู้ใช้จะได้อะไร)
    const deadline = Date.now() + 55000;
    for (const model of models) {
      if (closed) break;
      if (Date.now() > deadline - 3000) break;
      let streamed = false;
      try {
        full = await llmStream(
          model,
          messages,
          (delta) => { streamed = true; send("delta", { text: delta }); },
          { temperature: SPEED[speed].temperature, timeoutMs: Math.min(20000, Math.max(5000, deadline - Date.now())) }
        );
        if (full) { usedModel = true; break; }
      } catch (error: any) {
        const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
        const transient = isTimeout || [408, 429, 500, 502, 503, 504].includes(Number(error?.status));
        console.warn(`[stream] ${model} ล้มเหลว (${error?.status || error?.name || "?"})`);
        full = "";
        // โมเดลนี้พิมพ์ข้อความออกไปแล้วแต่ขาดกลางทาง → สั่งให้ฝั่งแอปล้างข้อความนั้น
        // ไม่งั้นคำตอบของโมเดลถัดไปจะต่อท้ายกันเป็นข้อความซ้ำ/มั่ว
        if (streamed) send("reset", { reason: transient ? "retry" : "error" });
        if (!transient) break;
      }
    }
    if (closed) { stopHeartbeat(); return; }
    if (!full) {
      const fallback = fallbackAnswer(ranked, casual, subject.name);
      send("delta", { text: fallback });
      usedModel = false;
    } else {
      answerCache.set(cacheKey, { answer: full, sources, grounded, at: Date.now() });
    }
    send("done", { usedModel, grounded, casual });
    stopHeartbeat();
    res.end();
  } catch (error) {
    stopHeartbeat();
    send("error", { error: String(error instanceof Error ? error.message : error) });
    res.end();
  }
});

/* ------------------------------------------------------------------ */
/* 3b) ดึงโจทย์จริงจากในวิชา + เลือกรูปแบบคำตอบ                          */
/* ------------------------------------------------------------------ */

/**
 * รวมตัวเลือกที่ซ้ำกันให้เหลือตัวเดียว
 *
 * AI มักสร้างตัวเลือกซ้ำ เช่น ["5", "5"] ซึ่งทำให้ผู้สอบเห็นตัวเลือกเดิมสองครั้ง
 * ข้อสำคัญ: เฉลยเก็บเป็น "เลขลำดับ" ของตัวเลือก ถ้าลบตัวเลือกทิ้งโดยไม่เลื่อนเลข
 * เฉลยจะชี้ไปที่ตัวเลือกผิดตัวทันที ฟังก์ชันนี้จึงต้องคืนเลขลำดับใหม่มาด้วย
 */
export function dedupeOptions(options: any[], answerIndex: number, minCount = 2) {
  const kept: string[] = [];
  const remap = new Map<number, number>();
  const seen = new Set<string>();

  options.forEach((raw, i) => {
    const text = String(raw ?? "").trim();
    if (!text) { remap.set(i, -1); return; }
    // เทียบแบบไม่สนตัวพิมพ์ ตัดช่องว่างเกิน และลบเครื่องหมายท้ายออก
    const key = text.toLowerCase().replace(/\s+/g, " ").replace(/\s*([,;:])\s*/g, "$1").replace(/[.,;:!?)\]]+$/g, "").trim();
    if (seen.has(key)) {
      remap.set(i, kept.indexOf(text) >= 0 ? kept.indexOf(text) : -1);
      return;
    }
    seen.add(key);
    remap.set(i, kept.length);
    kept.push(text);
  });

  // ถ้าเหลือน้อยกว่าขั้นต่ำ (เช่น ตัวเลือกซ้ำหมด) ให้เติมตัวเลือกตัวอย่างที่ไม่ซ้ำกัน
  const fillers = ["ไม่มีข้อมูล", "ไม่เกี่ยวข้อง", "ข้อมูลไม่เพียงพอ", "เป็นไปได้ทั้งหมด", "ไม่สามารถสรุปได้"];
  for (const f of fillers) {
    if (kept.length >= minCount) break;
    const key = f.toLowerCase();
    if (!seen.has(key)) { seen.add(key); kept.push(f); }
  }

  // หาเลขลำดับของเฉลยในรายการใหม่ (remap คือค่าหลัก, สำรองคือค้นจากข้อความเฉลยเดิม)
  const mapped = remap.has(answerIndex) ? (remap.get(answerIndex) as number) : -1;
  let finalAnswer = mapped >= 0 && mapped < kept.length ? mapped : -1;
  if (finalAnswer < 0) {
    const target = String(options[answerIndex] ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*([,;:])\s*/g, "$1");
    finalAnswer = kept.findIndex((o) => o.toLowerCase().replace(/\s+/g, " ").replace(/\s*([,;:])\s*/g, "$1") === target);
  }
  if (finalAnswer < 0) finalAnswer = 0;

  return { options: kept, answerIndex: finalAnswer, removed: options.length - kept.length };
}
/** รูปแบบคำตอบที่ให้เลือก */
type AnswerFormat = "text" | "options" | "code" | "flowchart" | "diagram" | "table" | "pseudocode" | "translate";
const FORMATS: Record<AnswerFormat, { label: string; hint: string; instruction: string }> = {
  text: { label: "ข้อความ", hint: "เขียนตอบเป็นข้อความ", instruction: "แสดงโจทย์เป็นข้อความอ่านง่าย ใช้หัวข้อย่อยและ bullet" },
  options: { label: "ตัวเลือก", hint: "A B C D", instruction: "แสดงโจทย์พร้อมตัวเลือก 4 ข้อ (ก ข ค ง) พร้อมเฉลยอธิบาย" },
  code: { label: "โค้ด", hint: "เขียนเป็นโปรแกรม", instruction: "เขียนโจทย์ภาษาไทยให้ผู้เรียนเขียนโปรแกรมเพื่อแก้ปัญหาจากเนื้อหานี้ โดยบอกข้อมูลนำเข้าและผลลัพธ์ที่ต้องการ ห้ามแสดงโค้ดเฉลยหรือโค้ดที่เติมเสร็จแล้ว" },
  flowchart: { label: "ผังภาพ", hint: "flowchart", instruction: "เขียนโจทย์ภาษาไทยให้ผู้เรียนวาด flowchart เพื่อหาคำตอบ โดยคงข้อมูลและเงื่อนไขจากต้นทางครบ ห้ามวาดผังเฉลยให้" },
  diagram: { label: "แผนผัง", hint: "ผังงาน/โครงสร้าง", instruction: "เขียนโจทย์ภาษาไทยให้ผู้เรียนสร้างแผนผังโครงสร้างหรือความสัมพันธ์ตามเนื้อหา โดยคงข้อมูลต้นทางครบ ห้ามแสดงแผนผังเฉลยให้" },
  table: { label: "ตาราง", hint: "เทียบข้อมูล", instruction: "แสดงโจทย์พร้อมตารางข้อมูลที่ต้องใช้ (ถ้ามี) ในกล่อง ``` จัดคอลัมน์ให้ตรงกัน" },
  pseudocode: { label: "รหัสเทียม", hint: "pseudocode", instruction: "แสดงโจทย์เป็นโจทย์เขียนรหัสเทียม (pseudocode) — เรียงขั้นตอนเป็นบรรทัด ๆ ด้วยคำสั่งภาษาอังกฤษง่าย ๆ เช่น BEGIN / IF / ELSE / WHILE / FOR / END ห้ามเป็นภาษาโปรแกรมจริง ห้ามใส่ชื่อฟังก์ชันหรือไวยากรณ์ของภาษาโปรแกรม" },
  // แนวสำหรับวิชาภาษา — หยิบประโยค/ข้อความจริงจากไฟล์ในวิชา มาให้แปลไทย<->อังกฤษเอง
  translate: { label: "แปลประโยค", hint: "ไทย ↔ อังกฤษ", instruction: "แสดงโจทย์เป็นการแปลภาษา — คัดประโยคหรือข้อความสั้น ๆ ที่มีจริงในเนื้อหาวิชานี้มา 1 ข้อ แล้วขึ้นต้นด้วยคำสั่งว่า \"แปลข้อความต่อไปนี้เป็น...\" โดยเลือกทิศทางให้ตรงกับต้นทาง (ต้นทางเป็นอังกฤษ = แปลเป็นไทย, ต้นทางเป็นไทย = แปลเป็นอังกฤษ) เว้นบรรทัดว่างใต้คำสั่งให้ผู้เรียนพิมพ์คำตอบแปลเอง ห้ามใส่คำแปลหรือเฉลยในโจทย์เด็ดขาด" },
};

const CODE_TASK_RULES =
  "โหมดนี้สร้างเฉพาะโจทย์เขียนโปรแกรมจากหัวข้อในไฟล์เรียน ห้ามใช้โจทย์คณิตศาสตร์ที่ไม่ได้สั่งให้เขียนโปรแกรม " +
  "ตัดโจทย์ที่มีเพียงการคำนวณนิพจน์หรือหาค่าตัวเลขโดยไม่ต้องเขียนโปรแกรมออก " +
  "เขียนภาษาไทยตรงและเข้าใจง่าย โดยจัดเป็นหัวข้อ งานที่ต้องทำ / ข้อมูลนำเข้า / เงื่อนไข / ผลลัพธ์ เมื่อมีข้อมูลในต้นฉบับ " +
  "ระบุค่าหรือข้อความที่ต้องแสดงให้ชัดถ้าต้นฉบับระบุไว้ ห้ามแต่งข้อความผลลัพธ์ภาษาอังกฤษหรือตัวอย่างข้อมูลเพิ่มเอง " +
  "ถ้าไฟล์มีกรณีเงื่อนไขจริง/เท็จหรือกรณีผิดพลาด ให้คงผลลัพธ์ของทุกกรณีไว้ในโจทย์ ห้ามตัดเงื่อนไขทิ้ง " +
  "อธิบายคำศัพท์ยากสั้น ๆ เมื่อจำเป็น แต่ห้ามเพิ่มข้อกำหนด ชนิดข้อมูล ตัวเลข หรือตัวอย่างที่ไม่มีในต้นฉบับ " +
  "ห้ามเขียนหัวข้อโจทย์ซ้ำท้ายคำถาม ห้ามใส่ประโยคเกริ่นลอย ๆ เช่น ‘ถ้าระบบรับค่าเข้ามา’ เมื่อบอกข้อมูลนำเข้าได้ตรง ๆ " +
  "ห้ามใส่ URL ชื่อวิดีโอ ชื่อไฟล์เป็นโจทย์ โค้ดเฉลย หรือเนื้อหาอื่นที่ไม่ใช่โจทย์.\n";
/**
 * รูปแบบที่ผู้ใช้เลือกเอง
 * คืน "" เมื่อไม่ได้เลือก -> ให้ระบบเลือกรูปแบบที่เหมาะกับโจทย์เอง
 * (ผู้ใช้ไม่ต้องเลือกซ้ำกับโหมดในเมนู ☰ อีกแล้ว)
 */
function pickFormat(v: any): AnswerFormat | "" {
  return (typeof v === "string" && v in FORMATS ? v : "") as AnswerFormat | "";
}

/* ------------------------------------------------------------------ */
/*  รูปแบบที่ "ใช้ได้จริง" กับโจทย์นี้ — ไม่ยกทุกอย่างมาให้เลือกรถลา     */
/* ------------------------------------------------------------------ */


/** เลือกรูปแบบที่เหมาะกับวิชา + โจทย์ล่าสุด
 *  hasCode = วิชานี้มีเนื้อหาเขียนโปรแกรมจริงในไฟล์ (ด้วย analyzeSubjectSignals)
 *            ถ้า false จะไม่ยกฟอร์แมต "โค้ด" มาให้เลือก แม้ชื่อวิชาจะดูเป็นสายคอมฯ */
function pickFormats(subjectName: string, problemText: string, hasCode = true): { list: { format: AnswerFormat; why: string }[]; recommended: AnswerFormat } {
  const tag = detectSubjectTag(subjectName);
  // ตัดชื่อวิชาออกจากโจทย์ก่อน ไม่งั้นคำว่า "คอมพิวเตอร์/โปรแกรม" ในชื่อวิชาจะทำให้ทุกวิชากลายเป็นวิชาโค้ด
  let raw = String(problemText || "").toLowerCase();
  for (const s of SUBJECT_SUFFIXES) raw = raw.split(s).join(" ");
  raw = raw.split(String(subjectName || "").toLowerCase()).join(" ");
  const p = raw;
  const hit = (...w: string[]) => w.some((x) => p.includes(x));
  const out: { format: AnswerFormat; why: string }[] = [];

  // ข้อบังคับ — ใช้ได้ทุกวิชา
  out.push({ format: "text", why: "ตอบเป็นข้อความ" });
  out.push({ format: "options", why: "เลือกจากตัวเลือก" });

  // ตามเนื้อหาโจทย์
  // "คำสั่ง" กำกวมมาก (คำสั่งโปรแกรม vs คำสั่งทางกฎหมาย) จึงต้องใช้คำที่ชี้เฉพาะโค้ดจริง ๆ
  const strongCode = hit("เขียนโปรแกรม", "เขียนโค้ด", "เขียนภาษาโปรแกรม", "โค้ด", "ฟังก์ชัน", "รหัสเทียม", "pseudocode", "อัลกอริทึม", "algorithm", "#include", "int main", "def ", "function ", "import ", "select * from");
  const weakCode = tag === "programming" && hasCode && hit("โปรแกรม", "code", "script");
  const wantsCode = strongCode || weakCode;
  const wantsFlow = hit("ผังงาน", "flowchart", "flow chart", "ขั้นตอน", "กระบวนการ", "ลำดับการทำงาน", "อัลกอริทึม");
  const wantsDiagram = hit("แผนผัง", "โครงสร้าง", "แผนภาพ", "diagram", "แผนที่", "ผังโครงสร้าง", "entity", "ความสัมพันธ์");
  const wantsTable = hit("ตาราง", "เปรียบเทียบ", "ตารางทดสอบ", "test case", "สรุปเป็นตาราง", "จัดลำดับ");

  // ตามสาขาวิชา (เป็นค่าเริ่มต้นถ้าโจทย์ไม่ได้บอก)
  const byTag =
    tag === "programming" ? { code: true, flow: true, table: true, diagram: false }
      : tag === "math" ? { code: false, flow: true, table: true, diagram: false }
        : tag === "science" ? { code: false, flow: true, table: true, diagram: true }
          : tag === "language" ? { code: false, flow: false, table: true, diagram: false }
            : { code: false, flow: false, table: false, diagram: false };

  if (wantsCode || (byTag.code && hasCode)) out.push({ format: "code", why: wantsCode ? "โจทย์นี้ให้เขียนโค้ด" : tag === "programming" ? "วิชานี้เกี่ยวกับการเขียนโปรแกรม" : "ตอบเป็นโค้ด" });
  if (wantsFlow || byTag.flow) out.push({ format: "flowchart", why: wantsFlow ? "โจทย์นี้มีขั้นตอน/ผังงาน" : "แสดงเป็นผังภาพ" });
  if (wantsDiagram || byTag.diagram) out.push({ format: "diagram", why: wantsDiagram ? "โจทย์นี้เป็นแผนผัง" : "แสดงเป็นแผนผัง" });
  if (wantsTable || byTag.table) out.push({ format: "table", why: wantsTable ? "โจทย์นี้มีตาราง/ข้อมูลเปรียบเทียบ" : "จัดเป็นตาราง" });

  // ตัวแนะนำ = รูปแบบเฉพาะที่ตรงกับโจทย์ที่สุด (ไม่ใช่ "ข้อความ" ที่มีอยู่ทุกวิชา)
  // ถ้าไม่มีอะไรเฉพาะเลย ใช้ "ตัวเลือก" แทน เพราะตอบเป็นตัวเลือกตรวจง่ายกว่า
  const specific = out.slice(2);
  return { list: out, recommended: (specific[0]?.format || "options") as AnswerFormat };
}

/** สิ่งที่โจทย์สั่งให้ทำ — เดาจากคำในโจทย์ตอน AI แยกไม่ได้ */
const DELIVERABLE_RULES: { label: string; words: string[] }[] = [
  { label: "ผังงาน (Flowchart)", words: ["ผังงาน", "flowchart", "flow chart", "ผังภาพความคิด"] },
  { label: "รหัสเทียม", words: ["รหัสเทียม", "pseudocode", "รหัสจำลอง", "อัลกอริทึม", "algorithm"] },
  { label: "ตารางทดสอบ", words: ["ตารางทดสอบ", "test case", "ตัวอย่างการทดสอบ", "กรณีทดสอบ"] },
  { label: "เขียนโปรแกรม", words: ["เขียนโปรแกรม", "เขียนโค้ด", "เขียนภาษา", "เขียนด้วย", "เขียนโปรแกรมภาษา"] },
  { label: "อธิบายหลักการ", words: ["อธิบาย", "อธิบายวิธี", "วิธีการทำงาน", "หลักการทำงาน"] },
  { label: "ผลลัพธ์ / ตัวอย่างผลรัน", words: ["ผลลัพธ์", "ตัวอย่างผล", "ผลการทำงาน", "แสดงผล"] },
  { label: "คำนวณ", words: ["คำนวณ", "หาผลรวม", "หาค่าเฉลี่ย", "หาสูงสุด", "หาต่ำสุด", "แปลงค่า"] },
];
function detectDeliverables(text: string): string[] {
  const low = String(text || "").toLowerCase();
  const hit = DELIVERABLE_RULES.filter((r) => r.words.some((w) => low.includes(w)));
  return (hit.length ? hit : DELIVERABLE_RULES.slice(3, 5)).map((r) => r.label);
}


/**
 * โหมดฝึกทำรหัสเทียม — กติกาให้ AI "แต่งโจทย์ใหม่" ก่อนขึ้นจอ:
 * เนื้อหาไฟล์มักเป็นคำตอบ/โค้ดสำเร็จรูป (เช่นบล็อก INPUT...END) ถ้าโชว์ดิบ = เห็นเฉลยตั้งแต่ก่อนทำ
 * เลยให้แปลงเป็น "คำถาม" ที่อ่านเข้าใจง่าย ไม่กระชับอัดกัน โครงรหัสเทียมถูกต้องมี start...stop
 */
const PSEUDO_QUESTION_RULES =
  "โจทย์นี้สำหรับโหมดฝึกเขียนรหัสเทียม — หน้าที่คือเปลี่ยนเนื้อหาต้นทางให้เป็น \"คำถาม\" ที่ผู้เรียนอ่านเข้าใจง่าย " +
  "กติกา: " +
  "(1) ต้องเป็นคำถาม/คำสั่งที่ผู้เรียนต้องเขียนรหัสเทียมตอบ ห้ามใส่วิธีทำ ห้ามใส่เฉลย " +
  "ห้ามคัดลอกโค้ดหรือรหัสเทียมสำเร็จรูปจากต้นทางมาเป็นโจทย์ " +
  "(2) ถ้าต้นทางเป็นคำตอบหรือส่วนโค้ดอยู่แล้ว ให้แปลงเป็นโจทย์ว่า \"จงเขียนรหัสเทียม...\" " +
  "พร้อมอธิบายเงื่อนไขทุกข้อเป็นภาษาไทยที่อ่านง่ายทีละข้อ ห้ามกระชับอัดกัน " +
  "(3) รหัสเทียมที่ถูกต้องต้องขึ้นต้นด้วย start และลงท้ายด้วย stop — ถ้าใส่ตัวอย่างโครงในโจทย์ให้ใช้ start...stop เสมอ " +
  "(4) คงตัวเลขและเงื่อนไขครบตามต้นฉบับ ห้ามตัดออก\ ";

/** ให้ AI จัดรูปแบบโจทย์ (คืน problem/formats/deliverables) */
async function renderProblem(subject: any, rawText: string, wanted: AnswerFormat | "", skip: string[], requestedLevel = "") {
  let format = wanted;
  const hasCode = analyzeSubjectSignals(subject?.materials || []).code >= EXTRA_MIN.code;
  const picked = pickFormats(subject.name, rawText, hasCode);
  let formats = picked.list;
  if (wanted && !formats.some((f) => f.format === wanted)) formats = [...formats, { format: wanted, why: "เลือกเอง" }];
  // ไม่ได้เลือกเอง -> ใช้รูปแบบที่ตรงกับโจทย์ที่สุด
  if (!wanted) format = picked.recommended;
  else if (!formats.some((f) => f.format === format)) format = formats[0]?.format || "text";
  // ถ้าผู้ใช้เลือกรูปแบบเอง ให้เคารพตัวเลือกนั้น แม้โจทย์ต้นทางจะมีโค้ดจริง
  // เลือกโค้ดอัตโนมัติเฉพาะเมื่อไม่ได้ระบุรูปแบบ
  if (!wanted && isRealCodeProblem(rawText, hasCode)) {
    format = "code";
    if (!formats.some((f) => f.format === "code")) formats = [...formats, { format: "code", why: "โจทย์ต้นทางเป็นโค้ดจริง" }];
  }

  let rendered = rawText;
  let options: any[] = [];
  let deliverables: string[] = [];
  // โหมดฝึกทำรหัสเทียม — ใช้กติกา "แต่งโจทย์ใหม่" (คำถามล้วน ไม่มีเฉลย) แทนการจัดรูปจากเนื้อหาดิบ
  const pseudoPractice = wanted === "pseudocode" && format === "pseudocode";

  try {
    const result: any = await llm(
      [
        {
          role: "system",
          content:
            (requestedLevel && format !== "code" ? levelEscalationRule(requestedLevel) : "") +
            (format === "code" ? CODE_TASK_RULES + "จัดโจทย์เพียงข้อเดียว ห้ามรวมหลายข้อเป็นงานชุดเดียว และห้ามนำข้อมูลจากข้ออื่นมาเติม\n" : "") +
            (pseudoPractice
              ? PSEUDO_QUESTION_RULES
              : "คุณคืออาจารย์ AI หน้าที่จัดโจทย์ให้อ่านง่ายเท่านั้น " +
                "ห้ามแก้เนื้อหา ห้ามเปลี่ยนตัวเลข ห้ามเพิ่มหรือลดเงื่อนไข ห้ามทำโจทย์ใหม่ ") +
            'ตอบเป็น JSON เท่านั้น รูปแบบ: {"problem":"โจทย์ที่จัดรูปแบบแล้ว","deliverables":["สิ่งที่โจทย์สั่งให้ทำ"]}\n' +
            "- deliverables คือรายการสิ่งที่โจทย์สั่งให้ทำจริงๆ ดึงจากโจทย์เท่านั้น\n" +
            (format === "options" ? 'เพิ่ม "options":[{"text":"...","correct":true},{"text":"..."}] จำนวน 4 ตัวเลือก\n' : "") +
            "สำคัญ: ห้ามมีคำอธิบายนอกกล่อง ห้ามขึ้นต้นด้วย 'ได้เลยครับ' ห้ามปิดท้ายด้วยคำถาม " +
              "ห้ามใส่โค้ดหรือบล็อก ``` ในคำตอบเด็ดขาด แม้โจทย์ต้นทางจะมีโค้ดฉบับเต็มติดมาก็ให้ตัดทิ้ง " +
              "เก็บไว้เฉพาะข้อความโจทย์กับตัวเลขที่นักเรียนต้องใช้คิดเท่านั้น " +
              "สำคัญมาก: ห้ามสรุปย่อ ห้ามตัดเงื่อนไขหรือตัวเลขใด ๆ ออก " +
              "ต้องคงเนื้อหาโจทย์ให้ครบทุกเงื่อนไขและทุกตัวเลขตามต้นฉบับ " +
              "ถ้าต้นฉบับยาว โจทย์ที่ตอบก็ต้องยาวพอๆ กัน ห้ามกลายเหลือแค่คำสั่งว่าให้ทำอะไร " +
            (pseudoPractice ? "ห้ามใส่คำตอบหรือเฉลยในตัวโจทย์\n" : "ใส่คำอธิบายไว้ในตัวโจทย์เป็นคอมเมนต์เท่านั้น\n") +
            "รูปแบบที่ต้องการ: " + (pseudoPractice
              ? "โจทย์ภาษาไทยอ่านง่าย บอกว่าให้เขียนรหัสเทียมทำอะไร มีเงื่อนไขทีละข้อ ไม่กระชับอัดกัน โครงรหัสเทียมที่ถูกต้องขึ้นต้นด้วย start และลงท้ายด้วย stop"
              : (FORMATS[format as AnswerFormat]?.instruction || FORMATS.text.instruction)),
        },
        { role: "user", content: "ชื่อวิชา: " + subject.name + "\nโจทย์ดิบ:\n" + rawText.slice(0, 1200) },
      ],
      { json: true, temperature: 0.3 }
    );
    if (result && typeof result.problem === "string" && result.problem.trim().length > 10) rendered = result.problem.trim().slice(0, 2000);
    if (Array.isArray(result?.deliverables)) deliverables = result.deliverables.map(String).filter(Boolean).slice(0, 8);
    if (format === "options" && Array.isArray(result?.options)) {
      options = result.options.slice(0, 4)
        .map((o: any) => ({ text: String(o?.text || "").slice(0, 200), correct: !!o?.correct }))
        .filter((o: any) => o.text);
    }
  } catch (error) {
    console.warn("จัดรูปแบบโจทย์ไม่สำเร็จ ใช้ข้อความดิบ", String(error));
  }

  if (format === "code") {
    rendered = cleanCodeQuestion(rendered);
    if (!isProgrammingTask(rendered)) rendered = cleanCodeQuestion(rawText);
    // โหมดโค้ดตรวจและส่งเฉพาะโปรแกรม ไม่ยก pseudocode/ผังงานจากเอกสารต้นทางเป็นงานที่ต้องส่งเพิ่ม
    deliverables = ["โปรแกรมที่ทำตามโจทย์"];
  }
  if (!deliverables.length) deliverables = detectDeliverables(rendered);
  // กันบทวิเคราะห์หลุดเข้าโจทย์ — ถ้ามีโจทย์จริงก่อนส่วนวิเคราะห์ ตัดออก (ว่างเปล่า = คงเดิม ไม่ลบโจทย์)
  const strippedRendered = stripAnalysis(rendered);
  if (strippedRendered) rendered = strippedRendered;

  // คำสั่งโจทย์ท้ายสุด ("จงเขียนโปรแกรม...") ห้ามหาย — AI บางรอบตัดทิ้ง = โจทย์ไม่รู้ว่าให้ทำอะไร
  const taskLine = findTaskLine(rawText);
  if (taskLine && !rendered.includes(taskLine.slice(0, 40))) {
    rendered = rendered.trim() + "\n\n" + taskLine;
  }
  // worked example ไม่มีบรรทัด "จง..." — task จริงอยู่ที่หัวข้อ ห้ามหายไปกับ AI เช่นกัน
  // (กันเฉพาะเมื่อ rendered ไม่มี task/หัวข้อใด ๆ แล้วจริง ๆ ไม่งั้นจะทับ variant ที่ AI แต่งเอง)
  if (!hasTaskLike(rendered)) {
    const head = findHeadTitle(rawText);
    if (head && !rendered.includes(head.slice(0, 25))) rendered = head + "\n" + rendered;
  }

  void skip;
  return { format, formats, problem: tidyProblem(rendered), options, deliverables, generatedByAi: rendered !== rawText };
}

/** สัญญาณว่าข้อความนี้ดูเหมือนโจทย์มากกว่าคำอธิบาย */
const PROBLEM_HINTS = [
  "โจทย์", "แบบฝึกหัด", "กำหนดให้", "จงเขียน", "ให้เขียน", "เขียนโปรแกรม", "คำนวณ",
  "แสดงผล", "รับข้อมูล", "ตัวแปร", "อินพุต", "เอาต์พุต", "input", "output",
  "exercises", "problem", "assign", "calculate", "compute", "write a program",
];

/** ดึงโจทย์จริงจากเนื้อหาในวิชา ไม่แต่งขึ้นเอง */
/* ------------------------------------------------------------------ */
/*  ตัด "บทวิเคราะห์โจทย์" ออกจากโจทย์                                   */
/*  สไลด์ของอาจารย์มีรูปแบบ: [โจทย์] / วิเคราะห์โจทย์ / Input / Output /   */
/*  Process / รหัสเทียม [เฉลย]  — เผลอเอาส่วนวิเคราะห์มาเป็นโจทย์ =        */
/*  ผู้เรียนเห็นเฉลยตั้งแต่แรก ทำโจทย์ไม่ได้จริง                          */
/*  โจทย์ต้องเป็น "คำถาม" ล้วน ส่วนวิเคราะห์ย้ายไปปุ่ม "วิเคราะห์โจทย์" แยก */
/* ------------------------------------------------------------------ */
/** บรรทัดหัวข้อของ "บทวิเคราะห์โจทย์" (Input/Output/Process/รหัสเทียม ฯลฯ) */
const ANALYSIS_HDR =
  /^(input|output|process|inputs?|outputs?|pseudocode|variables?|data ?types?|ตัวแปร(อื่น\s*ๆ)?|กำหนดค่าตัวแปร|ค่าเริ่มต้น|รหัสเทียม|ผังงาน|flowchart|ขั้นตอน(?:วิธี|การ(?:ทำ|แก้ปัญหา))?|วิเคราะห์\s*โจทย์)\s*[:：]?$/i;

function normalizeAnalysisHeader(line: string): string {
  return String(line || "").trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\d+\s*[.)]\s*/, "")
    .replace(/^[-•*]\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
}

function isAnalysisHeader(line: string): boolean {
  return ANALYSIS_HDR.test(normalizeAnalysisHeader(line));
}

/** ข้อความนี้เป็น "บทวิเคราะห์ล้วน" ไหม — พบหัวข้อบทวิเคราะห์อย่างน้อย 3 หัวข้อ */
function isAnalysisBody(text: string): boolean {
  const found = new Set<string>();
  for (const l of text.split("\n")) {
    const t = normalizeAnalysisHeader(l);
    if (ANALYSIS_HDR.test(t)) found.add(t.toLowerCase().replace(/[:：]\s*$/, ""));
  }
  return found.size >= 3;
}

/**
 * คืนข้อความ "ก่อน" ส่วนวิเคราะห์ (= ตัวโจทย์จริง)
 * คืน "" เมื่อทั้งก้อนเป็นบทวิเคราะห์ล้วน (ไม่มีโจทย์เหลือ)
 * คืนเดิมเมื่อไม่เจอสัญญาณวิเคราะห์เลย (โจทย์ปกติไม่ถูกแตะ)
 */
function stripAnalysis(src: string): string {
  const text = (src || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return src;

  // 1) มีหัวข้อ "วิเคราะห์โจทย์" ชัดเจน -> เก็บเฉพาะส่วนก่อนมัน
  const mk = text.search(/^\s*วิเคราะห์\s*โจทย์\s*[:：]?\s*$/im);
  if (mk >= 0) {
    const before = text.slice(0, mk).trim();
    return before.length >= 12 ? before : "";
  }

  // 2) หัวข้อส่วนวิเคราะห์ที่ AI/สไลด์ทำเป็น "[การวิเคราะห์งาน (Input / Process / Output)]"
  //    -> ตัดเฉพาะส่วนนั้น (ถึงหัวข้อ [...] / บรรทัดคำสั่ง "จง..." ถัดไป) เก็บส่วนอื่นไว้
  const cutSect = cutAnalysisSections(text);
  if (cutSect !== text) return cutSect.trim().length >= 12 ? cutSect.trim() : "";

  // 3) ไม่มีหัวข้อ "วิเคราะห์โจทย์" แต่กระจุกหัวข้อบทวิเคราะห์ (Input/Output/Process/รหัสเทียม...)
  if (isAnalysisBody(text)) {
    const lines = text.split("\n");
    const firstHdr = lines.findIndex(isAnalysisHeader);
    const before = lines.slice(0, Math.max(0, firstHdr)).join("\n").trim();
    return before.length >= 12 ? before : "";
  }

  // 4) ตาราง IPOดิบจาก PDF (คั่นด้วย tab หัวข้อ Input/Process/Output) -> ตัดถึงบรรทัดคำสั่ง "จง..." ถัดไป
  const cutIpo = cutRawIpo(text);
  if (cutIpo !== text) return cutIpo.trim().length >= 12 ? cutIpo.trim() : "";

  return src;
}

/** บรรทัดหัวข้อส่วนวิเคราะห์ที่ทำเป็นวงเล็บ: "[การวิเคราะห์งาน (Input / Process / Output)]" / "การวิเคราะห์:" */
function isAnalysisSectLine(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 100) return false;
  if (/^(จง|ให้)/.test(t)) return false; // ประโยคคำสั่งไม่ใช่หัวข้อ
  if (/^\[\s*(?:การ)?วิเคราะห์[^\]]*\]$/.test(t)) return true; // [การวิเคราะห์...]
  return /^(?:การ)?วิเคราะห์(?:โจทย์|งาน|ปัญหา)?\s*[:：]\s*$/.test(t); // "การวิเคราะห์:"
}

/**
 * ตัดทุกส่วนที่ขึ้นต้นด้วยหัวข้อวิเคราะห์ ออกจนถึง
 * หัวข้อส่วนถัดไป ([...] หรือ Input/Process/...) / บรรทัดคำสั่ง "จง..." / ท้ายข้อความ
 * เก็บส่วนที่เหลือ (โจทย์/รหัสเทียมที่โจทย์อ้างถึง/ข้อกำหนด) ไว้
 */
function cutAnalysisSections(text: string): string {
  let cur = text;
  for (let g = 0; g < 10; g++) {
    const lines = cur.split("\n");
    const start = lines.findIndex(isAnalysisSectLine);
    if (start < 0) break;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^\[.*\]$/.test(t) || isAnalysisHeader(t) || /^(จง|ให้เขียน)/.test(t)) { end = i; break; }
    }
    cur = lines.slice(0, start).concat(lines.slice(end)).join("\n");
    if (!cur.trim()) break;
  }
  return cur;
}

/**
 * ตาราง IPOดิบจาก PDF (คั่นด้วย tab แถวหัวข้อ Input/Process/Output) = ส่วนวิเคราะห์
 * ตัดจากจุดเริ่มตารางถึงบรรทัดคำสั่ง "จง..." ถัดไป (เก็บคำสั่งไว้) หรือถึงท้ายตารางถ้าไม่มีคำสั่ง
 * ตารางข้อมูลปกติ (หัวข้อไม่ใช่ input/output/process) ถูกแตะ
 */
function cutRawIpo(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  let changed = false;
  while (i < lines.length) {
    if (!lines[i].includes("\t")) { i++; continue; }
    // รวมแถบที่ติดกัน (ยอมรับบรรทัดตัดคำไม่มี tab คั่น ถ้าถัดไปยังมี tab)
    let j = i;
    while (j < lines.length) {
      if (lines[j].includes("\t")) { j++; continue; }
      const t = lines[j].trim();
      if (t && t.length <= 50 && j + 1 < lines.length && lines[j + 1].includes("\t")) { j++; continue; }
      break;
    }
    const run = lines.slice(i, j);
    const hdrCells = run[0].split("\t").map((c) => c.trim().toLowerCase());
    const hdrHit = hdrCells.filter((c) => /^(input|output|process)$/.test(c)).length;
    if (run.length >= 2 && hdrHit >= 2) {
      let end = lines.length;
      for (let k = j; k < lines.length; k++) {
        if (/^\s*(จง|ให้เขียน)/.test(lines[k])) { end = k; break; }
      }
      lines.splice(i, end - i);
      changed = true;
      continue; // ตรวจตำแหน่ง i ใหม่ (อาจมีตารางต่อ)
    }
    i = j;
  }
  return changed ? lines.join("\n") : text;
}

/** หาบรรทัดคำสั่งโจทย์ ("จงเขียนโปรแกรม...") ในข้อความต้นฉบับ — ใช้คืนโจทย์เมื่อ AI ตัดทิ้ง */
function findTaskLine(src: string): string {
  const ls = String(src || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const rev = ls.slice().reverse();
  return rev.find((l) => /^จง/.test(l) && l.length >= 12 && l.length <= 300)
    || rev.find((l) => /^ให้เขียน|^ให้ทำ|^ให้อธิบาย/.test(l) && l.length >= 12 && l.length <= 300)
    || "";
}

/**
 * หัวข้อ/คำสั่งโจทย์ เช่น "ตัวอย่างที่ 3.2 เขียนโปรแกรมแปลงอุณหภูมิ..."
 * worked example ในเอกสารไม่มีบรรทัด "จง..." — task จริงอยู่ที่ "หัวข้อ" ก่อนบล็อกเนื้อหา
 */
const TASK_TITLE_RE =
  /^(?:ตัวอย่าง(?:\s*ที่)?\s*[\dA-Za-z]|ตัวอย่าง\s*[:：]|แบบฝึกหัด|ข้อ\s*(?:ที่)?\s*\d|โจทย์|ใบงาน|แบบทดสอบ|จง|ให้เขียน|ให้ทำ|ให้อธิบาย)/;

/** หาหัวข้อโจทย์จากบรรทัดต้น ๆ ของต้นฉบับ (ใช้คืนเมื่อ AI ตัดหัวข้อทิ้ง) */
function findHeadTitle(src: string): string {
  let seen = 0;
  for (const l of String(src || "").split(/\r?\n/)) {
    const t = l.trim();
    if (!t) continue;
    if (++seen > 3) break;
    if (t.length >= 12 && t.length <= 200 && TASK_TITLE_RE.test(t)) return t.replace(/\t+/g, "  ");
  }
  return "";
}

/** ข้อความมี "คำสั่ง/หัวข้อโจทย์" แล้วหรือยัง — กันคืนหัวข้อต้นฉบับทับโจทย์ที่มีอยู่แล้ว */
function hasTaskLike(text: string): boolean {
  if (findTaskLine(text)) return true;
  let seen = 0;
  for (const l of String(text || "").split(/\r?\n/)) {
    const t = l.trim();
    if (!t) continue;
    if (++seen > 6) break;
    if (t.length >= 12 && t.length <= 200 && TASK_TITLE_RE.test(t)) return true;
  }
  return false;
}

/**
 * ย้อนหาหัวข้อโจทย์ที่อยู่ก่อนตำแหน่ง pos (ย้อน ~800 ตัวอักษร หยุดที่เครื่องหมายหน้า)
 * — ใช้เติม taskให้บล็อกที่ไม่มีบรรทัด "จง..." (worked example มี task อยู่ที่หัวข้อ)
 */
function findSectionTitleBefore(full: string, pos: number): string {
  const lines = full.slice(Math.max(0, pos - 800), pos).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(t)) break; // ข้ามหน้า = บริบทคนละส่วน ห้ามเอาหัวข้อข้ามหน้า
    if (t.length > 200) continue;
    if (t.length >= 12 && TASK_TITLE_RE.test(t)) return t.replace(/\t+/g, "  ");
  }
  return "";
}

function isProgrammingTask(text: string): boolean {
  const s = String(text || "");
  const directThaiPrompt =
    /(?:จง|ให้|โปรด)\s*(?:เขียน|สร้าง|พัฒนา|แก้ไข|เติม)\s*(?:โปรแกรม|โค้ด|รหัสโปรแกรม|ฟังก์ชัน)/i.test(s) ||
    /(?:^|\n)\s*(?:(?:\d+[.)]|(?:ตัวอย่าง|example)(?:\s*ที่)?\s*[\dA-Za-z.-]+)\s*)?(?:เขียน|สร้าง|พัฒนา|แก้ไข|เติม)\s*(?:โปรแกรม|โค้ด|รหัสโปรแกรม|ฟังก์ชัน)/im.test(s);
  const directEnglishPrompt = /\b(?:write|implement|create|complete|debug)\s+(?:an?\s+)?(?:program|code|source\s*code|function|script)\b/i.test(s);
  // ข้อความอธิบายว่า “ต้องการสร้างโปรแกรม” ไม่ใช่คำสั่งให้ผู้เรียนเขียนโค้ด
  // โหมดโค้ดรับเฉพาะโจทย์ที่สั่งให้เขียน/แก้โปรแกรมโดยตรง
  return directThaiPrompt || directEnglishPrompt;
}

function problemKey(materialId: string, text: string): string {
  const normalized = String(text || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  // เก็บข้อความโจทย์ให้พอแยกข้อย่อยที่มีหัวนำเดียวกัน
  return `${materialId}|${normalized.slice(0, 1200)}`;
}

type CodeLessonMaterial = { id: string; title: string; textContent: string };

/** Exclude lesson rows whose opening identifies a different course number. */
function materialMatchesSubject(subjectName: string, material: { title?: string | null; textContent?: string | null }): boolean {
  const subjectCode = String(subjectName || "").match(/\b\d{7}\b/)?.[0];
  if (!subjectCode) return true;

  const opening = String(material.textContent || "")
    .slice(0, 2400)
    .replace(/\b(\d{4})\s+(\d{3})\b/g, "$1$2");
  const codes = [...opening.matchAll(/\b\d{7}\b/g)].map((match) => match[0]);
  if (!codes.length || codes.every((code) => code === subjectCode)) return true;

  const ownIndex = codes.indexOf(subjectCode);
  const firstCode = codes[0];
  const foreignCount = codes.filter((code) => code !== subjectCode).length;
  // ไฟล์ที่เปิดมาด้วยรหัสวิชาอื่น หรือมีแต่รหัสวิชาอื่น ถูกแนบผิด/ชื่อไม่ตรงเนื้อหา
  return ownIndex >= 0 && firstCode === subjectCode && foreignCount < 2;
}

function materialsForSubject(subject: { name: string; materials?: any[] }) {
  return (subject.materials || []).filter((material: any) => materialMatchesSubject(subject.name, material));
}

function codeLessonChunks(text: string): string[] {
  const clean = String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^\s*(?:วิดีโอ\s+)?YouTube\s*:\s*.*$/gim, "")
    .trim();
  if (!clean) return [];
  const pages = clean.split(/(?=^\s*--\s*\d+\s+of\s+\d+\s*--\s*$)/gim);
  const chunks: string[] = [];
  for (const page of pages) {
    const normalized = page.trim();
    if (!normalized) continue;
    if (normalized.length <= 1400) {
      chunks.push(normalized);
      continue;
    }
    let current = "";
    for (const line of normalized.split(/\r?\n/)) {
      if (current.length + line.length > 1100 && current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      current += `${line}\n`;
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks;
}

function codeLessonRelevance(problem: string, excerpt: string): number {
  const q = String(problem || "").toLocaleLowerCase();
  const s = String(excerpt || "").toLocaleLowerCase();
  const stop = new Set(["the", "and", "for", "with", "from", "this", "that", "program", "write", "จง", "เขียน", "โปรแกรม", "ข้อมูล", "แสดง", "ทำงาน"]);
  const words = (q.match(/[a-z_][a-z0-9_+#]{2,}/g) || []).filter((w) => !stop.has(w));
  let score = 0;
  for (const word of new Set(words)) if (s.includes(word)) score += word.includes("_") ? 6 : 2;
  const thaiRuns = q.match(/[\u0E00-\u0E7F]{4,}/g) || [];
  const grams = new Set<string>();
  for (const run of thaiRuns) for (let i = 0; i + 3 <= run.length; i += 2) grams.add(run.slice(i, i + 3));
  let thaiHits = 0;
  for (const gram of grams) if (s.includes(gram)) thaiHits++;
  score += Math.min(12, thaiHits * 0.4);
  const numericValues = q.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const value of new Set(numericValues)) if (s.includes(value)) score += 1;
  return score;
}

function buildCodeLessonReference(materials: CodeLessonMaterial[], materialId: string, problem: string) {
  const ordered = sortByTitle(materials);
  const sourceIndex = ordered.findIndex((material) => material.id === materialId);
  const source = sourceIndex >= 0 ? ordered[sourceIndex] : undefined;
  if (!source) return { language: "C", reference: "" };

  const sourceText = String(source.textContent || "");
  const previous = ordered.slice(0, sourceIndex);
  const cScore = (sourceText.match(/\b(?:scanf|printf)\b|stdio\.h/gi) || []).length;
  const cppScore = (sourceText.match(/\b(?:cin|cout)\b|iostream/gi) || []).length;
  const priorText = previous.map((material) => material.textContent || "").join("\n");
  const priorC = (priorText.match(/\b(?:scanf|printf)\b|stdio\.h/gi) || []).length;
  const priorCpp = (priorText.match(/\b(?:cin|cout)\b|iostream/gi) || []).length;
  const language = cScore > cppScore || (cScore === cppScore && priorC >= priorCpp) ? "C" : "C++";
  const ioPattern = language === "C" ? /\b(?:scanf|printf)\b/i : /\b(?:cin|cout)\b|iostream/i;
  const incompatiblePattern = language === "C"
    ? /\b(?:cin|cout)\b|iostream|using\s+namespace\s+std|std::/i
    : /\b(?:scanf|printf)\b|stdio\.h/i;
  const codePattern = /\b(?:scanf|printf|cin|cout|for|while|if|int|float|double|char)\b|\b\w+\s*\[[^\]]+\]/i;

  const sourceChunks = codeLessonChunks(sourceText);
  const questionContext = sourceChunks
    .map((excerpt) => ({ excerpt, score: codeLessonRelevance(problem, excerpt) }))
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, 2)
    .map((item) => item.excerpt);
  const codeExamples = sourceChunks
    .filter((excerpt) => codePattern.test(excerpt) && !incompatiblePattern.test(excerpt))
    .map((excerpt) => ({ excerpt, score: codeLessonRelevance(problem, excerpt) }))
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, 2)
    .map((item) => item.excerpt);

  const relatedExamples = ordered
    .filter((material) => material.id !== source.id)
    .flatMap((material) => codeLessonChunks(material.textContent)
      .filter((excerpt) => ioPattern.test(excerpt) && codePattern.test(excerpt) && !incompatiblePattern.test(excerpt))
      .map((excerpt) => ({ title: material.title, excerpt, score: codeLessonRelevance(problem, excerpt) })))
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, 2)
    .map((item) => `${item.title}: ${item.excerpt}`);

  const prerequisite = [...previous].reverse().find((material) =>
    ioPattern.test(String(material.textContent || "")) && codePattern.test(String(material.textContent || "")) && !incompatiblePattern.test(String(material.textContent || ""))
  );
  const prerequisiteExamples = prerequisite
    ? codeLessonChunks(prerequisite.textContent)
        .filter((excerpt) => ioPattern.test(excerpt) && codePattern.test(excerpt) && !incompatiblePattern.test(excerpt))
        .slice(0, 2)
        .map((excerpt) => `${prerequisite.title}: ${excerpt}`)
    : [];

  const sections = [
    ...questionContext.map((excerpt) => `ส่วนที่ตรงกับโจทย์ในไฟล์ ${source.title}:\n${excerpt}`),
    ...codeExamples.map((excerpt) => `ตัวอย่างคำสั่งในไฟล์ ${source.title}:\n${excerpt}`),
    ...relatedExamples.map((excerpt) => `ตัวอย่างภาษาและหัวข้อที่เกี่ยวข้องจากไฟล์ในวิชาเดียวกัน (ใช้เฉพาะคำสั่ง): ${excerpt}`),
    ...prerequisiteExamples.map((excerpt) => `ตัวอย่างภาษาที่เรียนมาก่อน: ${excerpt}`),
  ];
  const uniqueSections = [...new Set(sections)];
  let reference = "";
  for (const section of uniqueSections) {
    if (reference.length >= 6500) break;
    reference += `${reference ? "\n\n" : ""}${section.slice(0, Math.max(0, 6500 - reference.length))}`;
  }
  return { language, reference };
}

function cleanCodeQuestion(text: string): string {
  const withoutSourceAnalysis = stripAnalysis(String(text || "")) || String(text || "");
  const lines = withoutSourceAnalysis
    .replace(/```[\s\S]*?```/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trim()
      .replace(/^\d{1,3}\s+(?=(?:แบบที่\s*\d+|(?:Example|ตัวอย่าง)(?:\s*ที่)?\s*[\dA-Za-z.-]+))/i, "")
      .replace(/^(?:แบบที่\s*\d+|(?:Example|ตัวอย่าง)(?:\s*ที่)?\s*[\dA-Za-z.-]+)\s*(?=(?:จง|ให้|โปรด|เขียน|สร้าง|พัฒนา))/i, ""))
    .filter((line) => !/^\s*(?:วิดีโอ\s+)?YouTube\s*:/i.test(line) && !/^\s*(?:ลิงก์|URL|แหล่งที่มา)\s*[:：]/i.test(line));

  const usable: string[] = [];
  let followsExampleHeading = false;
  for (const line of lines) {
    if (!line || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;
    if (/^(?:Example|ตัวอย่าง)(?:\s*ที่)?\s*\d+(?:[.-]\d+)?(?:\s*\(ต่อ\))?$|^แบบที่\s*\d+$/i.test(line)) {
      followsExampleHeading = true;
      continue;
    }
    if (followsExampleHeading && /^\d{1,3}$/.test(line)) {
      followsExampleHeading = false;
      continue;
    }
    followsExampleHeading = false;
    if (/^(?:Input|Process|Output|สิ่งที่โจทย์ต้องการ|งานที่ต้องทำ|ข้อมูลนำเข้า|เงื่อนไข|ผลลัพธ์)\s*[:：]?$/i.test(line)) continue;
    if (/^(?:(?:วิชา|รายวิชา|course)\s*)?\d{7}\s*(?:[-–:]|[A-Za-z])/i.test(line)) continue;
    usable.push(line);
  }

  // PDF/OCR มักตัดประโยคเดียวเป็นหลายบรรทัด ให้ต่อเฉพาะบรรทัดที่เป็นการตัดคำ
  // คงรายการและหัวข้อเงื่อนไขไว้คนละบรรทัดเพื่อให้อ่านง่าย
  const paragraphs: string[] = [];
  let current = "";
  const flush = () => { if (current) paragraphs.push(current); current = ""; };
  for (const line of usable) {
    const structural = /^(?:[-•*]\s|\d+[.)]\s|(?:งานที่ต้องทำ|ข้อมูลนำเข้า|เงื่อนไข|ผลลัพธ์|เงื่อนไขเพิ่มเติมจากโจทย์ในไฟล์เรียน)\s*[:：])/i.test(line);
    if (structural) {
      flush();
      paragraphs.push(line);
    } else {
      current = current ? `${current} ${line}` : line;
    }
  }
  flush();
  return clarifySourceCodeQuestion(normalizeThaiOcr(paragraphs.join("\n").replace(/[ \t]{2,}/g, " ").trim()));
}

/** Correct common Thai OCR substitutions in extracted coding exercises without changing their facts. */
function normalizeThaiOcr(text: string): string {
  return String(text || "")
    .replace(/ต\s+่ำ/g, "ต่ำ")
    .replace(/นิสิตจำก/g, "นิสิตจาก")
    .replace(/อ่ำน/g, "อ่าน")
    .replace(/ค่ำ/g, "ค่า")
    .replace(/ควำม/g, "ความ")
    .replace(/กว้ำง/g, "กว้าง")
    .replace(/ผืนผ้ำ/g, "ผืนผ้า")
    .replace(/หำ/g, "หา")
    .replace(/ที่\s+ได้/g, "ที่ได้")
    .replace(/กำร/g, "การ")
    .replace(/ถ้ำ/g, "ถ้า")
    .replace(/มำก/g, "มาก")
    .replace(/กว่ำ/g, "กว่า")
    .replace(/เท่ำ/g, "เท่า")
    .replace(/ถือว่ำ/g, "ถือว่า")
    .replace(/ผ่ำน/g, "ผ่าน")
    .replace(/ไม่ผ่ำน/g, "ไม่ผ่าน")
    .replace(/รำคำ/g, "ราคา")
    .replace(/สินค้ำ/g, "สินค้า")
    .replace(/จ่ำย/g, "จ่าย")
    .replace(/หำส่วนลด/g, "หาส่วนลด")
    .replace(/คำนวณหำ/g, "คำนวณหา")
    .replace(/\s+([,.:;])/g, "$1")
    .replace(/ {2,}/g, " ");
}

/** Make the source's pass/fail threshold explicit while preserving its exact threshold and outcomes. */
function clarifySourceCodeQuestion(text: string): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const isPassFailThreshold =
    /เขียนโปรแกรม/.test(normalized) &&
    /(?:มากกว่าหรือเท่ากับ|ตั้งแต่)\s*50/.test(normalized) &&
    /ผ่าน/.test(normalized) &&
    /ต่ำกว่า/.test(normalized) &&
    /ไม่ผ่าน/.test(normalized);
  if (!isPassFailThreshold) return text;

  return [
    "จงเขียนโปรแกรมรับคะแนนสอบของนิสิต แล้วแสดงผลการสอบตามเงื่อนไขต่อไปนี้:",
    "- คะแนนตั้งแต่ 50 คะแนนขึ้นไป ให้แสดงว่า ผ่าน",
    "- คะแนนต่ำกว่า 50 คะแนน ให้แสดงว่า ไม่ผ่าน",
  ].join("\n");
}

function codeTaskAlreadyIncluded(problem: string, sourceTask: string): boolean {
  const normalize = (value: string) => String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  const rendered = normalize(problem);
  const source = normalize(sourceTask);
  if (!source || source.length < 18) return true;
  // OCR มักสลับสระ/วรรณยุกต์ตอนท้าย ทำให้เช็ค 40 ตัวอักษรแบบตรงตัว
  // แล้วเติมคำสั่งโจทย์ซ้ำทั้งประโยค ให้ยืนยันจากส่วนหัวที่จำเพาะแทน
  const distinctPrefixLength = Math.min(22, source.length);
  return rendered.includes(source.slice(0, distinctPrefixLength));
}

function splitNumberedProgrammingTasks(text: string): string[] {
  // OCR often joins "แบบที่ 1", "แบบที่ 2" examples into one paragraph.
  const markers = [...text.matchAll(/(?:^|\s)((?:ข้อ\s*\d+|แบบที่\s*\d+|(?:ตัวอย่าง|example)(?:\s*ที่)?\s*[\dA-Za-z.-]+)\s*[:：.]?)\s*/gim)];
  if (markers.length < 2) return [text];
  const first = markers[0].index ?? 0;
  const header = text.slice(0, first).trim().replace(/^\d{1,3}$/, "")
    .replace(/จง\s*เขียนโปรแกรม(?:เพื่อ)?แก้ปัญหาจากโจทย์(?:ทั้ง\s*\d+\s*ข้อ)?(?:ดังต่อไปนี้|ต่อไปนี้)?/i, "จงเขียนโปรแกรมแก้โจทย์ย่อยต่อไปนี้")
    .replace(/ตามเงื่อนไขของแต่ละข้อ/gi, "ตามเงื่อนไขของโจทย์ย่อยแต่ละข้อ");
  return markers.map((marker, i) => {
    const start = (marker.index ?? 0) + marker[0].length;
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    return `${header ? `${header}\n` : ""}${marker[1]} ${body}`.trim();
  }).filter(Boolean);
}

function addCodeTaskRequirements(fullText: string, taskText: string, startAt: number): string {
  const tail = String(fullText || "").slice(Math.max(0, startAt));
  const boundary = /(?:^|\n)\s*(?:(?:ตัวอย่าง(?:\s*ที่)?|example|exercise)\s*[\dA-Za-z]+(?:[.-][\dA-Za-z]+)?|แบบฝึกหัด\s*(?:ที่\s*)?\d+)/gim;
  const headings = [...tail.matchAll(boundary)];
  const currentHeading = headings[0] && (headings[0].index ?? 0) < 300 ? headings[0] : null;
  const sectionStart = currentHeading ? (currentHeading.index ?? 0) : 0;
  const sectionText = tail.slice(sectionStart);
  const sectionHeadings = [...sectionText.matchAll(boundary)];
  const nextHeading = currentHeading ? sectionHeadings[1] : sectionHeadings[0];
  const sectionEnd = nextHeading?.index ?? Math.min(sectionText.length, 5000);
  const section = sectionText.slice(0, sectionEnd).slice(0, 5000);
  const processMatch = /(?:^|\n)\s*Process\s*(?:\r?\n)/i.exec(section);
  if (!processMatch) return taskText;

  const processAt = processMatch.index ?? 0;
  const inputMatches = [...section.slice(0, processAt).matchAll(/(?:^|\n)\s*Input\s*(?:\r?\n)/gim)];
  const start = inputMatches.length ? (inputMatches[inputMatches.length - 1].index ?? processAt) : processAt;
  const requirements = section.slice(start).split(/\r?\n/).filter((rawLine) => {
    const line = rawLine.trim();
    if (!line || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) || /^\d+$/.test(line)) return false;
    if (/^(?:1204\s*\d{3}|Input|Process|Output)\b.*$/i.test(line) && !/^(?:Input|Process|Output)$/i.test(line)) return false;
    if (/^(?:start|stop|read\b|print\b|if\s*\(|else\b|endif\b|return\b|#include\b|(?:int|float|double|char)\s+\w+|\w+\s*=\s*[^=]+;)/i.test(line)) return false;
    return /[\u0E00-\u0E7F]|^(?:Input|Process|Output)$/i.test(line);
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (requirements.length < 15) return taskText;
  return `${taskText.trim()}\n\nเงื่อนไขเพิ่มเติมจากโจทย์ในไฟล์เรียน:\n${requirements.slice(0, 1400)}`;
}

function extractProblems(materials: any[], limit = 8, perFileCap = 2, codeOnly = false) {
  const scored: { text: string; source: any; score: number }[] = [];

  for (const m of materials) {
    const full = String(m.textContent || "")
      .replace(/^\s*(?:วิดีโอ\s+)?YouTube\s*:\s*/gim, "")
      .replace(/^\s*(?:ลิงก์|Link|URL)\s*[:：].*$/gim, "")
      .trim();
    if (full.length < 60) continue;

    // ตัดเป็นย่อหน้า แล้วให้คะแนนย่อหน้าที่ดูเป็นโจทย์
    // ต้องรู้ "ตำแหน่ง" ของแต่ละบล็อกใน full ด้วย เพื่อค้นหาหัวข้อโจทย์ที่อยู่ก่อนบล็อก
    const segs: { text: string; pos: number }[] = [];
    const blockRe = /\n\s*\n|\n(?=\d+[\.\)]\s)/g;
    let last = 0;
    let mm: RegExpExecArray | null;
    while ((mm = blockRe.exec(full))) {
      segs.push({ text: full.slice(last, mm.index), pos: last });
      last = mm.index + mm[0].length;
    }
    segs.push({ text: full.slice(last), pos: last });

    for (const seg of segs) {
      const rawBlock = seg.text.replace(/https?:\/\/\S+/gi, "").trim();
      for (const b of codeOnly ? splitNumberedProgrammingTasks(rawBlock) : [rawBlock]) {
      if (b.length < 40 || b.length > 700) continue;
      // ไม่ใช่โจทย์: คำอธิบายรายวิชา / วัตถุประสงค์ / ผลลัพธ์การเรียนรู้ — ข้ามทุกวิชา
      if (/คำอธิบายรายวิชา|ผลลัพธ์การเรียนรู้|รายละเอียดรายวิชา|วัตถุประสงค์รายวิชา|ขอบเขตเนื้อหา|ชื่อวิชา\s*[:：]|การเรียนการสอน/.test(b)) continue;
      // สารบัญแบบ "(หน้า 3)" ซ้ำ 2 รายการขึ้นไป = รายการบท ไม่ใช่โจทย์
      if ((b.match(/\(หน้า\s*\d+\)/g) || []).length >= 2) continue;
      // ขยะ OCR จากไดอะแกรม (สัญลักษณ์ | ~ @ = กระจายเกิน 12% นับเฉพาะส่วนที่ไม่ใช่บล็อกโค้ด)
      const noFence = b.replace(/```[\s\S]*?```/g, "");
      const sym = (noFence.match(/[|~@#$%^&*_=+<>[\]{}\\/]/g) || []).length;
      if (noFence.length && sym / noFence.length > 0.12) continue;
      const low = b.toLowerCase();
      let score = 0;
      for (const h of PROBLEM_HINTS) if (low.includes(h)) score += 2;
      // มีตัวเลขหลายตัว = มักเป็นโจทย์ที่คำนวณได้
      const nums = (b.match(/\d+(?:\.\d+)?/g) || []).length;
      if (nums >= 3) score += 2;
      if (/^\s*\d+[\.\)]/.test(b)) score += 2;
      if (/\b(if|for|while|int|float|sum|array|loop)\b/i.test(b)) score += 1;
      // ชื่อไฟล์ที่บอกว่าเป็นแบบฝึกหัด
      if (/แบบฝึกหัด|โจทย์|exercise|lab|worksheet|ใบงาน|แบบทดสอบ/i.test(String(m.title))) score += 3;
      if (score >= 3) {
        // ตัดหัวเรื่องซ้ำๆ ที่ติดมากับไฟล์ (วิชา/หัวข้อ/โจทย์) ทิ้ง เหลือแต่ตัวโจทย์จริง
        const clean = b
          .replace(/^\s*#{0,6}\s*\**\s*(วิชา|หัวข้อ|โจทย์|แบบฝึกหัด|กำหนด|ที่มา|หัวข้อเรียนรู้)\s*\**\s*[:：]\s*/gim, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        // ตัดบทวิเคราะห์ (Input/Output/Process/รหัสเทียม) ออก — โจทย์ต้องเป็นคำถามล้วน
        // ถ้าเป็นบทวิเคราะห์ล้วน (ไม่มีโจทย์เหลือ) = ข้าม ไม่เอาเฉลยมาเป็นโจทย์
        const problem = stripAnalysis(clean);
        if (!problem || problem.length < 30) continue;
        // worked example ไม่มีบรรทัด "จง..." (task จริงอยู่ที่หัวข้อก่อนบล็อก เช่น "ตัวอย่างที่ 3.2 เขียนโปรแกรม...")
        // -> ย้อนหาหัวข้อที่อยู่ก่อนบล็อกมาต่อหน้าไว้ ไม่งั้นโจทย์ไม่รู้ว่าให้ทำอะไร
        let text = problem;
        if (!findTaskLine(text)) {
          const segStart = seg.pos + (seg.text.length - seg.text.trimStart().length);
          const title = findSectionTitleBefore(full, segStart);
          if (title && !text.includes(title.slice(0, 25))) text = title + "\n" + text;
        }
        // โจทย์ที่นำเสนอได้ต้องมีคำสั่ง/คำถามจริง ไม่ใช้ชื่อวิดีโอ ลิงก์ หรือชื่อบทแทนโจทย์
        if (!hasTaskLike(text)) continue;
        if (codeOnly && !isProgrammingTask(text)) continue;
        if (codeOnly && splitNumberedProgrammingTasks(rawBlock).length === 1) {
          const segStart = seg.pos + (seg.text.length - seg.text.trimStart().length);
          text = addCodeTaskRequirements(full, text, segStart);
        }
        scored.push({ text, source: { materialId: m.id, title: m.title, sourceLabel: m.sourceLabel, updatedAt: m.externalUpdatedAt, url: m.externalUrl }, score });
      }
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  // กันโจทย์ซ้ำจากไฟล์เดียวกัน เก็บไว้ไม่เกิน 2 ข้อ
  const perFile: Record<string, number> = {};
  return scored.filter((s) => {
    const k = s.source.materialId;
    perFile[k] = (perFile[k] || 0) + 1;
    return perFile[k] <= perFileCap;
  }).slice(0, limit);
}

/**
 * วิชาภาษา (อังกฤษ/ไทย): ไฟล์มักมีแต่บทบรรยาย/บทความ ไม่มี "แบบฝึกหัด" ให้ดึง
 * แต่ยังฝึก "แปลประโยค" ได้โดยใช้ประโยคจริงจากไฟล์เท่านั้น (ห้าม AI แต่งประโยคใหม่)
 * คืนรายการพร้อม source เพื่อให้ไหลไปเข้า renderProblem ตามปกติ
 */
function translateSentencePool(materials: any[], limit = 40) {
  const out: { text: string; source: any; score: number }[] = [];
  const seen = new Set<string>();
  for (const m of materials) {
    const body = String(m.textContent || "")
      .replace(/^\s*(?:วิดีโอ\s+)?YouTube\s*:\s*.*$/gim, "")
      .replace(/^\s*(?:ลิงก์|Link|URL)\s*[:：].*$/gim, "");
    for (const raw of body.split(/[\r\n]+|(?<=[.!?])\s+/)) {
      const s = raw.replace(/\s+/g, " ").trim().replace(/^\s*\d+[.)]\s*/, "");
      if (s.length < 40 || s.length > 220) continue;
      if (seen.has(s)) continue;
      if (/,\s*,/.test(s)) continue;                                // แถว CSV มีช่องว่าง
      if ((s.match(/\d/g) || []).length > s.length * 0.2) continue; // แถวรหัสนิสิต/ตัวเลข
      if (/@|https?:\/\/|www\./i.test(s)) continue;
      if (/^[^\n:]{2,45}:/.test(s)) continue;                       // ป้ายหัวข้อ "Instructors:..." / "Audio file links: ..."
      if (/\(\d\)/.test(s)) continue;                               // รายการอ้างอิง "(1) ... (2) ..."
      const letters = (s.match(/[A-Za-z\u0E00-\u0E7F]/g) || []).length;
      if (letters < 30 || letters / s.length < 0.6) continue;
      if (s.split(/\s+/).length < 7 && !/[\u0E00-\u0E7F]/.test(s)) continue;
      seen.add(s);
      const thai = (s.match(/[\u0E00-\u0E7F]/g) || []).length > letters * 0.5;
      out.push({
        text: (thai ? "แปลข้อความต่อไปนี้เป็นภาษาอังกฤษ" : "แปลข้อความต่อไปนี้เป็นภาษาไทย") + "\n\n" + s,
        source: { materialId: m.id, title: m.title, sourceLabel: m.sourceLabel, updatedAt: m.externalUpdatedAt, url: m.externalUrl },
        // ประโยคที่ลงท้ายด้วยจุด/คำถาม = ประโยคสมบูรณ์ ให้เลือกก่อนประโยคตัดท่อน
        score: letters + (/[.!?。！？]$/.test(s) ? 200 : 0),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** สุ่มเลือกโจทย์ เพื่อไม่ให้ถามซ้ำเดิมทุกครั้ง */
function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * คำสำคัญจาก label หัวข้อที่ผู้ใช้เลือก — ใช้จับโจทย์ว่า "ตรงหัวข้อ" ไหม
 * "ผังงาน / Flowchart" -> ["ผังงาน", "flowchart"]
 * "Input-Process-Output" -> ["input", "process", "output"]
 * ไทยตั้งแต่ 3 ตัวอักษร / อังกฤษตั้งแต่ 4 ตัวอักษร (กันคำสั้น ๆ อย่าง "map" จับผิด)
 */
function topicTokens(label: string): string[] {
  return String(label || "")
    .split(/[/\-–—,()（）\[\]{}|·・\s]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => (w.length >= 3 && /[\u0E00-\u0E7F]/.test(w)) || (w.length >= 4 && /^[a-z0-9+#.]+$/.test(w)));
}

/** โจทย์ข้อนี้ตรงกับหัวข้อที่ผู้ใช้เลือกไหม (มีคำสำคัญคำใดคำหนึ่งของหัวข้อโผล่ในโจทย์) */
function topicMatches(lowText: string, token: string): boolean {
  if (!token) return false;
  if (lowText.includes(token)) return true;
  // ภาษาไทยไม่มีเว้นวรรค — label ยาวอย่าง "ลอจิกเกตและวงจรลอจิก" ไม่เคยโผล่ตรง ๆ ในโจทย์
  // เลยลองชิ้นส่วน 4 ตัวอักษรทีละ 2 ขั้นด้วย (เช่น "ลอจิก", "ความ", "มจำ") — ผิดบ้างไม่เป็นไร
  // เพราะผลลัพธ์เกินจริงแค่ทำให้ pool กว้างขึ้น ไม่ทำให้โจทย์หาย
  if (/[\u0E00-\u0E7F]/.test(token) && token.length >= 6) {
    for (let i = 0; i + 4 <= token.length && i < 14; i += 2) {
      if (lowText.includes(token.slice(i, i + 4))) return true;
    }
  }
  return false;
}

function matchTopics(text: string, topics: string[]): boolean {
  const low = String(text || "").toLowerCase();
  return topics.some((t) => topicTokens(t).some((tok) => topicMatches(low, tok)));
}

/**
 * ตัดโจทย์ตามหัวข้อที่ผู้ใช้เลือกตอนกด "ดึงโจทย์"
 * ไม่เลือก = ผ่านทั้งหมด / เลือกแล้วไม่มีโจทย์ตรง = ดึงจากทั้งวิชาแทน (กันค้างหน้าว่าง)
 */
function filterByTopics<T extends { text: string; source?: { title?: string } }>(list: T[], topics: string[]): T[] {
  if (!topics.length) return list;
  // จับทั้งเนื้อหาโจทย์และ "ชื่อไฟล์ต้นทาง" — ไฟล์ชื่อชัด (เช่น lab-logic.pdf) ช่วยให้เจอโจทย์ที่เนื้อหา OCR เพี้ยน
  const hit = list.filter((p) => matchTopics(p.text, topics) || matchTopics(p.source?.title || "", topics));
  return hit.length ? hit : list;
}

/**
 * ตัดโค้ดออกจากโจทย์ แต่ "ต้องเก็บข้อความโจทย์ที่ถูกปนอยู่ในบล็อกโค้ดไว้"
 *
 * ไฟล์งานหลายชิ้นเขียนแบบนี้:
 *   ```python
 *   # เติมโค้ดให้สมบูรณ์
 *   จงเขียนโปรแกรมรับค่า 10 จำนวน แล้วหาผลรวมเฉพาะเลขคู่ที่มากกว่า 20
 *   n = int(input())
 *   ```
 * ถ้าลบทั้งบล็อกทิ้ง = โจทย์กับข้อมูลจริงหายไปหมด เหลือแต่โครงสร้าง (ผังงาน/รหัสเทียม)
 * เลยแยกทีละบรรทัด: เก็บบรรทัดที่เป็น "ภาษาไทย" ทิ้งบรรทัดที่เป็นโค้ด
 */
function stripCodeKeepThai(src: string): string {
  return String(src || "").replace(/```[\s\S]*?```/g, (block) => {
    const body = block.replace(/^```[a-zA-Z0-9]*\r?\n?/, "").replace(/```\s*$/, "");
    const keep = body.split(/\r?\n/).filter((ln) => {
      const t = ln.trim();
      if (!t) return false;
      const thai = (t.match(/[\u0E00-\u0E7F]/g) || []).length;
      if (thai < 4) return false;                                     // ไม่ใช่ภาษาไทย = ไม่ใช่ข้อความโจทย์
      if (/^(#|\/\/|\/\*|\*\/)/.test(t)) return false;                 // คอมเมนต์ในโค้ด ไม่ใช่โจทย์
      // ข้อความไทยมักมีวงเล็บ (M/F) หรือเครื่องหมายคำพูด จึงห้ามตัดเพราะเจอ "(" เฉย ๆ
      if (/[;{}=]|=>|\)\s*[:{]/.test(t)) return false;                 // เครื่องหมายที่แปลว่าเป็นโค้ดจริง
      if (/\b(def|print|input|int|float|double|str|string|var|let|const|class|function|return|for|while|if|else|elif|include|import|scanf|printf|echo|cin|cout)\b/i.test(t)) return false;
      return true;
    });
    return keep.join("\n");
  });
}

/* ------------------------------------------------------------------ */
/*  ระดับความยาก — อิง "ลำดับไฟล์ใน Classroom" (เรียงตามบท/สัปดาห์)        */
/*  ไฟล์ต้น ๆ (บทแรก/สัปดาห์แรก) = พื้นฐาน ไฟล์ท้าย = ยาก               */
/*  การดึงโจทย์เรียงง่ายก่อน = เรียงตามลำดับไฟล์นี้จากบนลงล่างนั่นเอง   */
/* ------------------------------------------------------------------ */
const LEVEL_TH: Record<string, string> = { easy: "ง่าย", medium: "กลาง", hard: "ยาก" };

function fileLevel(index: number, total: number): "easy" | "medium" | "hard" {
  const r = index / Math.max(1, total);
  return r < 1 / 3 ? "easy" : r < 2 / 3 ? "medium" : "hard";
}

/**
 * ไม่เจอข้อระดับที่ผู้เรียนเลือกในไฟล์ที่เลือก (โจทย์ต่อไฟล์มีน้อย เจอบ่อย)
 * = "ทำข้อที่มีต่อ แต่ให้ AI ต่อยอดให้ยาก/ตรงระดับขึ้น" ตามกติกาข้อนี้
 */
function levelEscalationRule(level: string): string {
  if (!LEVEL_TH[level]) return "";
  return (
    "ปรับระดับความยาก: ผู้เรียนเลือกระดับ" + LEVEL_TH[level] +
    "ให้ปรับโจทย์ข้อนี้ตามระดับที่เลือกโดย " +
    (level === "hard"
      ? "เพิ่มเงื่อนไขซ้อน กรณีพิเศษ หรือจำนวนขั้นตอนให้คิดหลายขั้น ให้ซับซ้อนและยากขึ้น"
      : level === "medium"
        ? "ปรับให้มีเงื่อนไขพอประมาณ ไม่ง่ายไม่ยากเกินไป"
        : "ตัดเหลือเงื่อนไขหลัก ทำให้กระชับและคิดทีละขั้น ง่ายขึ้น") +
    " คงหัวข้อและแนวคิดเดิมของโจทย์ไว้ ยังคงห้ามใส่โค้ดและเฉลยในตัวโจทย์เหมือนเดิม\n"
  );
}

/** รายชื่อไฟล์ในวิชา (เรียงตามลำดับใน Classroom) + จำนวนโจทย์ที่ดึงได้ + ระดับยากง่าย */
router.get("/diagnose/files", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.query?.subjectId || "").trim();
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id }, include: { materials: true } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
    const sorted = sortByTitle(materialsForSubject(subject));
    // นับโจทย์แบบเพดาน 10 ข้อ/ไฟล์ — ตรงกับเพดานตอนดึงจากไฟล์ที่เลือก (จำนวนตรงกับที่เห็นบนจอ)
    // (extractProblems ปกติจำกัด 2 ข้อ/ไฟล์สำหรับการสุ่มทั่วไป)
    const raw = extractProblems(sorted, 100000, 10);
    const codeRaw = extractProblems(sorted, 100000, 10, true);
    const counts: Record<string, number> = {};
    const codeCounts: Record<string, number> = {};
    for (const p of raw) counts[p.source.materialId] = (counts[p.source.materialId] || 0) + 1;
    for (const p of codeRaw) codeCounts[p.source.materialId] = (codeCounts[p.source.materialId] || 0) + 1;
    const codeFiles = sorted.filter((material: any) => codeCounts[material.id]);
    const codeLevels = new Map<string, "easy" | "medium" | "hard">();
    codeFiles.forEach((material: any, index: number) => codeLevels.set(material.id, fileLevel(index, codeFiles.length)));
    res.json({
      files: sorted.map((m: any, i: number) => ({
        id: m.id,
        title: m.title,
        count: counts[m.id] || 0,
        level: fileLevel(i, sorted.length),
        codeCount: codeCounts[m.id] || 0,
        codeLevel: codeLevels.get(m.id) || "",
      })),
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

router.post("/diagnose/problem", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    let wanted = pickFormat(req.body?.format);
    let format = wanted;
    const skip = Array.isArray(req.body?.seen) ? req.body.seen.map(String) : [];
    // หัวข้อที่ผู้ใช้เลือกตอนกด "ดึงโจทย์" — กรองเฉพาะโจทย์ที่ตรงหัวข้อ
    const onlyTopics: string[] = Array.isArray(req.body?.topics)
      ? req.body.topics.map((t: any) => String(t || "").trim()).filter(Boolean)
      : [];
    // เลือกไฟล์ต้นทาง (1 ไฟล์) + ระดับความยากจากหน้าเลือก — มีผลทุกแนวข้อสอบ
    const onlyMaterial = String(req.body?.materialId || "").trim();
    const requestedLevel: string = ["easy", "medium", "hard"].includes(req.body?.level)
      ? String(req.body.level)
      : "";
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id }, include: { materials: true } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    const usableSubject = { ...subject, materials: materialsForSubject(subject) };

    // hasCode = ดูจากเนื้อหาไฟล์จริงของวิชา — วิชาที่ไม่มีเขียนโค้ดจะไม่ถูกยกฟอร์แมต "โค้ด" มาให้เลือก
    // และใช้คัดโจทย์ใน "โหมดฝึกทำรหัสเทียม" ให้มีเฉพาะข้อที่ตอบเป็นรหัสเทียมได้จริง
    const hasCode = analyzeSubjectSignals(usableSubject.materials || []).code >= EXTRA_MIN.code;
    // ป้องกันคำขอจาก client รุ่นเก่าหรือการเรียกตรง: วิชาที่ไม่มีเนื้อหาโค้ดจะไม่เข้าโหมดโค้ด/รหัสเทียม
    if (!hasCode && (wanted === "code" || wanted === "pseudocode")) { wanted = ""; format = ""; }
    // แหล่งที่มา: ไฟล์ในวิชา (ค่าเริ่มต้น) หรืองานที่นักเรียนเคยส่งไป
    if (String(req.body?.source || "") === "submission") {
      const rows = await prisma.submission.findMany({
        where: { userId: req.user.id, subjectId: subject.id },
        orderBy: { updatedAt: "desc" },
        take: 30,
      });
      const items = rows.map((r) => ({
        text: r.textContent,
        score: Math.min(10, r.textContent.length / 300),
        source: {
          materialId: r.id,
          title: r.title,
          sourceLabel: r.sourceLabel || "งานที่ส่ง",
          updatedAt: r.updatedAt,
          url: r.externalUrl,
          kind: "งานที่ส่ง",
          state: r.state,
          grade: r.grade,
          late: r.late,
        },
      }));
      if (!items.length) {
        return res.status(404).json({
          error: "ยังไม่พบงานที่ส่งไปในวิชานี้",
          hint: 'ระบบอ่านได้จากงานที่ส่งใน Google Classroom เท่านั้น — กลับไปหน้า Classroom แล้วกด "ซิงก์" เพื่อนำเข้างานที่ส่ง',
        });
      }
      // ข้อโค้ดจริงไม่ถูกกรองทิ้งแล้ว — AI จะแต่งข้อโค้ดให้เป็นคำถามได้ทุกแนว (รวมโหมดฝึก)
      const pool = filterByTopics(extractProblems(items as any[], 8, wanted === "code" ? 10 : 2, wanted === "code"), onlyTopics);
      if (wanted === "code" && !pool.length) {
        return res.status(404).json({ error: "ยังไม่พบโจทย์เขียนโปรแกรมในงานที่ส่ง", hint: "เลือกไฟล์บทเรียนที่มีเนื้อหาการเขียนโปรแกรมแทน" });
      }
      const usable = pool.length ? pool : items.slice(0, 6);
      const picked = pickRandom(usable) || usable[0];
      const rendered = await renderProblem(usableSubject, picked.text, wanted, skip, requestedLevel);
      return res.json({
        ...rendered,
        source: picked.source,
        origin: "submission",
        totalProblems: usable.length,
      });
    }

    // ข้อโค้ดจริงไม่ถูกกรองทิ้งแล้ว — เอาข้อโค้ดมาให้ AI แต่งเป็นโจทย์ตามแนวที่เลือกเองได้ (รวมโหมดฝึก)
    // ระดับความยากอิง "ลำดับไฟล์ใน Classroom" (เรียงตามบท/สัปดาห์) — ไฟล์ต้น = ง่าย ไฟล์ท้าย = ยาก
    const sortedMats = sortByTitle(usableSubject.materials || []);
    const matOrder = new Map<string, number>();
    sortedMats.forEach((m: any, i: number) => matOrder.set(m.id, i));
    const matTotal = Math.max(1, sortedMats.length);
    const orderIdx = (p: any) => matOrder.get(p?.source?.materialId) ?? 1e9;
    const allCodeCandidates = wanted === "code"
      ? filterByTopics(extractProblems(sortedMats, 100000, 10, true), onlyTopics)
      : [];
    // Difficulty is ranked over files that actually contain programming tasks.
    // Counting empty files or unrelated notices made every early code task look "medium".
    const codeTaskFiles = sortedMats.filter((material: any) =>
      allCodeCandidates.some((candidate: any) => candidate.source.materialId === material.id)
    );
    const codeLevelByMaterial = new Map<string, "easy" | "medium" | "hard">();
    codeTaskFiles.forEach((material: any, index: number) => {
      codeLevelByMaterial.set(material.id, fileLevel(index, codeTaskFiles.length));
    });
    const sourceLevel = (problem: any): "easy" | "medium" | "hard" => wanted === "code"
      ? codeLevelByMaterial.get(problem?.source?.materialId) || fileLevel(orderIdx(problem), matTotal)
      : fileLevel(orderIdx(problem), matTotal);

    // แหล่งโจทย์: ไฟล์ที่เลือก / ไฟล์ระดับที่เลือก / ทั้งวิชา
    // (ดึงเยอะพอให้เรียงง่ายก่อนได้จริง — เดิมจำกัด 8 ข้อจากสูงสุดทำให้ไฟล์ที่เลือก/ระดับที่ขอไม่อยู่ในกองเลย)
    let poolMaterials: any[] = usableSubject.materials || [];
    if (onlyMaterial && wanted !== "code") {
      poolMaterials = poolMaterials.filter((m: any) => m.id === onlyMaterial);
    } else if (requestedLevel && wanted !== "code") {
      const lv = sortedMats.filter((m: any, i: number) => fileLevel(i, sortedMats.length) === requestedLevel);
      if (lv.length) poolMaterials = lv;
    }
    let levelFallback = false;
    let all: any[];
    if (wanted === "code") {
      const selectedMaterialTasks = onlyMaterial
        ? allCodeCandidates.filter((candidate: any) => candidate.source.materialId === onlyMaterial)
        : allCodeCandidates;
      if (onlyMaterial) {
        all = selectedMaterialTasks;
      } else if (requestedLevel) {
        all = selectedMaterialTasks.filter((candidate: any) => sourceLevel(candidate) === requestedLevel);
        if (!all.length && selectedMaterialTasks.length) {
          all = selectedMaterialTasks;
          levelFallback = true;
        }
      } else {
        all = selectedMaterialTasks;
      }
    } else {
      all = filterByTopics(extractProblems(poolMaterials, 60, onlyMaterial ? 10 : 2, false), onlyTopics);
    }
    // เลือกไฟล์ไว้แต่ไฟล์นั้นดึงโจทย์ไม่ได้ -> บอกตรง ๆ ให้เลือกไฟล์อื่น
    if (onlyMaterial && !all.length) {
      return res.status(404).json({
        error: wanted === "code" ? "ไฟล์ที่เลือกยังไม่มีโจทย์เขียนโปรแกรมที่ดึงได้" : "ไฟล์ที่เลือกยังไม่มีโจทย์ที่ดึงได้",
        hint: wanted === "code" ? "เลือกไฟล์บทเรียนที่มีแบบฝึกเขียนโปรแกรม" : "ลองเลือกไฟล์อื่นในรายชื่อ หรือกดซิงก์ Classroom เพื่ออัปเดตไฟล์",
      });
    }
    // ระดับที่เลือกไม่มีโจทย์เลย -> ใช้โจทย์จริงจากไฟล์ที่ใกล้ระดับที่สุด ห้ามสร้างเงื่อนไขใหม่
    if (!all.length && requestedLevel && !onlyMaterial && wanted !== "code") {
      all = filterByTopics(extractProblems(usableSubject.materials, 60, 2, false), onlyTopics);
      levelFallback = !!all.length;
    }
    // วิชาภาษา: ไม่มี "แบบฝึกหัด" ในไฟล์ แต่ยังฝึกแปลประโยคจริงจากเนื้อหาได้
    if (!all.length && format === "translate") {
      all = translateSentencePool(poolMaterials.length ? poolMaterials : usableSubject.materials);
    }
    if (!all.length) {
      // แยกสาเหตุให้ตรงจริง: ไฟล์ว่าง/เป็นลิงก์ กับ ไฟล์มีเนื้อหาแต่ไม่มีแบบฝึกหัด
      const textChars = (usableSubject.materials || [])
        .reduce((sum: number, m: any) => sum + String(m.textContent || "").trim().length, 0);
      return res.status(404).json({
        error: textChars < 200 ? "ไฟล์ในวิชานี้ยังไม่มีข้อความให้ดึงโจทย์" : "ไฟล์ในวิชานี้เป็นบทบรรยาย/ประกาศ ไม่มีแบบฝึกหัดให้ดึง",
        hint: textChars < 200
          ? "ไฟล์อาจเป็นวิดีโอหรือลิงก์ — ลองซิงก์ Classroom ใหม่ หรือเลือกวิชาอื่น"
          : wanted === "code"
            ? "ลองเลือกวิชาที่มีแบบฝึกเขียนโปรแกรม หรือเลือกไฟล์ช่วงต้นที่มีตัวแปร อาร์เรย์ เงื่อนไข หรือลูป"
            : "วิชาภาษาใช้ \"แปลประโยค\" ได้ · วิชาอื่นลองเลือกไฟล์อื่นในรายชื่อ หรือเพิ่มไฟล์แบบฝึกหัดใน Classroom",
      });
    }

    // เรียง "ง่ายก่อน" เสมอ — ตามลำดับไฟล์ในวิชา (บทแรก/สัปดาห์แรกอยู่ก่อน)
    const levelRank: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
    const levelDistance = (p: any) => requestedLevel
      ? Math.abs(levelRank[sourceLevel(p)] - levelRank[requestedLevel])
      : 0;
    const candidates = all.slice().sort((a, b) => levelDistance(a) - levelDistance(b) || orderIdx(a) - orderIdx(b));
    // เลือกไฟล์ + ระดับพร้อมกัน: ไฟล์ที่เลือกไม่ได้อยู่ระดับที่ขอ -> คงข้อที่มี แล้วให้ AI ต่อยอดให้ตรงระดับ
    if (onlyMaterial && requestedLevel && sourceLevel(candidates[0]) !== requestedLevel) {
      levelFallback = true;
    }

    // เลี่ยงโจทย์ที่เพิ่งทำไปแล้ว
    // โจทย์ซ้อน = ดึงจากไฟล์เดียวกับที่กำลังทำอยู่ เพื่อให้โครงสร้างตรงกัน
    const baseId = String(req.body?.baseMaterialId || "");
    const sameAsCurrent = baseId ? all.find((p: any) => p.source.materialId === baseId) : null;
    const fresh = candidates.filter((p) => !skip.includes(problemKey(p.source.materialId, p.text)));
    // เรียงง่ายก่อน = เอาข้อใหม่ "ระดับล่างสุด" ที่ยังไม่เคยทำ (สุ่มภายในไฟล์นั้น กันซ้ำจำเจ)
    const pickBySourceLevel = (list: any[], fallback: any[]) => {
      if (!list.length) return pickRandom(fallback)!;
      const closestDistance = Math.min(...list.map(levelDistance));
      const closest = list.filter((p) => levelDistance(p) === closestDistance);
      const firstFile = Math.min(...closest.map(orderIdx));
      return pickRandom(closest.filter((p) => orderIdx(p) === firstFile))!;
    };
    const chosen = sameAsCurrent || pickBySourceLevel(fresh, candidates);

    // รูปแบบที่ใช้ได้จริงกับโจทย์นี้ — คำนวณจากโจทย์ดิบ แล้วเลือกอันที่ตรงที่สุดให้เอง
    // (hasCode คำนวณไว้ด้านบนแล้ว — โหมดรหัสเทียมคัดข้อโค้ดจริงทิ้งไปก่อนถึงตรงนี้)
    const pickedF = pickFormats(subject.name, chosen.text, hasCode);
    let formats = pickedF.list;
    if (wanted && !formats.some((f) => f.format === wanted)) {
      formats = [...formats, { format: wanted, why: "เลือกเอง" }];
    }
    if (!wanted) format = pickedF.recommended;
    else if (!formats.some((f) => f.format === format)) format = formats[0]?.format || "text";
    // เคารพแนวที่ผู้ใช้เลือกไว้; เลือกโค้ดอัตโนมัติเฉพาะเมื่อไม่ได้เลือกแนว
    if (!wanted && isRealCodeProblem(chosen.text, hasCode)) {
      format = "code";
      if (!formats.some((f) => f.format === "code")) {
        formats = [...formats, { format: "code", why: "โจทย์ต้นทางเป็นโค้ดจริง" }];
      }
    }
    // ให้ AI จัดรูปแบบโจทย์ให้อ่านง่าย แต่ห้ามเปลี่ยนเนื้อหา
    let rendered = chosen.text;
    let options: { text: string; correct: boolean; explain?: string }[] = [];
    let deliverables: string[] = [];
    const isVariant = !!req.body?.variant;
    // โหมดฝึกทำรหัสเทียม — ให้ AI แต่งโจทย์ใหม่เป็นคำถามล้วน (ไม่ใช่คำตอบ/โค้ดสำเร็จรูปจากไฟล์)
    const pseudoPractice = wanted === "pseudocode" && format === "pseudocode" && !isVariant;
    // ไม่เจอข้อระดับที่เลือกในไฟล์ -> สั่ง AI ต่อยอดข้อที่มีให้ตรงระดับ (ยากขึ้น/ง่ายขึ้น)
    const levelRule = levelFallback && format !== "code" ? levelEscalationRule(requestedLevel) : "";
    let aiRendered = false;

    try {
      const result: any = await llm(
        [
          {
            role: "system",
            content:
              (format === "code" ? CODE_TASK_RULES + "เลือกและจัดรูปแบบเพียงโจทย์เดียว ห้ามรวมหลายข้อเป็นงานชุดเดียว หรือย้ายข้อมูลจากข้ออื่นมาใส่ข้อนี้\n" : "") +
              (isVariant
                ? "คุณคืออาจารย์ AI หน้าที่สร้างโจทย์ซ้อนให้นักเรียนลองทำเอง " +
                  "ต้องสร้างโจทย์ใหม่ที่โครงสร้างเหมือนโจทย์ต้นทาง แต่เปลี่ยนตัวเลข ชื่อ หรือค่าให้ต่างออกไป " +
                  "ห้ามคัดลอกโจทย์เดิมมาทั้งก้อน ให้โจทย์ยากพอๆ กับต้นทาง\n" +
                  "ข้อห้ามสำคัญที่สุด: ห้ามใส่โค้ดใดๆ เด็ดขาด ไม่ว่าจะเป็นโค้ดเต็ม โค้ดตัวอย่าง " +
                  "โครงสร้างโค้ดให้เติมเอง หรือบรรทัดไหนก็ตามที่เป็นโค้ด " +
                  "ห้ามใส่บล็อกล่วงหน้า ``` ในคำตอบ ห้ามใส่ input() print() scanf printf " +
                  "ห้ามใส่ชื่อตัวแปรหรือฟังก์ชันของภาษาโปรแกรม ห้ามอธิบายวิธีทำ " +
                  "ส่งเฉพาะข้อความโจทย์ล้วน ๆ ที่นักเรียนอ่านแล้วต้องเขียนเองได้เท่านั้น\n"
                : pseudoPractice
                  ? PSEUDO_QUESTION_RULES
                  : "คุณคืออาจารย์ AI หน้าที่จัดโจทย์ให้อ่านง่ายเท่านั้น " +
                    "ห้ามแก้เนื้อหา ห้ามเปลี่ยนตัวเลข ห้ามเพิ่มหรือลดเงื่อนไข ห้ามทำโจทย์ใหม่ ") +
              'ตอบเป็น JSON เท่านั้น รูปแบบ: {"problem":"โจทย์ที่จัดรูปแบบแล้ว","deliverables":["สิ่งที่โจทย์สั่งให้ทำ"]}\n' +
              "- deliverables คือรายการสิ่งที่โจทย์สั่งให้ทำจริงๆ เช่น ผังงาน, รหัสเทียม, ตารางทดสอบ, เขียนโปรแกรม, อธิบายผลลัพธ์ " +
              "  ดึงจากโจทย์เท่านั้น ถ้าโจทย์ไม่ได้สั่งอะไรเพิ่มให้คำสั่งให้ครบตามที่โจทย์ต้องการจริง " +
              (format === "options"
                ? 'และเพิ่ม "options":[{"text":"...","correct":true},{"text":"..."}] จำนวน 4 ตัวเลือก ให้มี correct:true 1 ตัวเลือกเท่านั้น ตัวอื่นเป็นตัวหลอกที่สมเหตุสมผล\n'
                : "") +
              "สำคัญ: ห้ามมีคำอธิบายนอกกล่อง ห้ามขึ้นต้นด้วย 'ได้เลยครับ' ห้ามปิดท้ายด้วยคำถาม " +
              "ห้ามใส่โค้ดหรือบล็อก ``` ในคำตอบเด็ดขาด แม้โจทย์ต้นทางจะมีโค้ดฉบับเต็มติดมาก็ให้ตัดทิ้ง " +
              "เก็บไว้เฉพาะข้อความโจทย์กับตัวเลขที่นักเรียนต้องใช้คิดเท่านั้น " +
              "สำคัญมาก: ห้ามสรุปย่อ ห้ามตัดเงื่อนไขหรือตัวเลขใด ๆ ออก " +
              "ต้องคงเนื้อหาโจทย์ให้ครบทุกเงื่อนไขและทุกตัวเลขตามต้นฉบับ " +
              "ถ้าต้นฉบับยาว โจทย์ที่ตอบก็ต้องยาวพอๆ กัน ห้ามกลายเหลือแค่คำสั่งว่าให้ทำอะไร " +
              (isVariant || pseudoPractice ? "ห้ามใส่คำตอบหรือเฉลยในตัวโจทย์ " : "ใส่คำอธิบายไว้ในตัวโจทย์เป็นคอมเมนต์เท่านั้น\n") +
              "รูปแบบที่ต้องการ: " + (pseudoPractice
                ? "โจทย์ภาษาไทยอ่านง่าย บอกว่าให้เขียนรหัสเทียมทำอะไร มีเงื่อนไขทีละข้อ ไม่กระชับอัดกัน โครงรหัสเทียมที่ถูกต้องขึ้นต้นด้วย start และลงท้ายด้วย stop"
                : (FORMATS[format as AnswerFormat]?.instruction || FORMATS.text.instruction)) +
              levelRule,
          },
          {
            role: "user",
            content:
              "ชื่อวิชา: " + subject.name + "\n" +
              "ไฟล์ต้นทาง: " + chosen.source.title + "\n" +
              (isVariant ? "โจทย์ต้นทาง (ใช้เป็นต้นแบบเท่านั้น ห้ามคัดลอก):\n" : "โจทย์ดิบ:\n") + chosen.text.slice(0, 1200),
          },
        ],
        { json: true, temperature: 0.3 }
      );

      if (result && typeof result.problem === "string" && result.problem.trim().length > 10) {
        rendered = result.problem.trim().slice(0, 2000);
        aiRendered = true;
      }

      // โจทย์ต้องไม่มีโค้ด ไม่ว่าจะเป็นโจทย์ต้นทางหรือโจทย์ซ้อน
      // เพราะไฟล์งานของอาจารย์หลายชิ้นมี "เฉลย" ติดมาด้วย (เช่น # เติมโค้ดให้สมบูรณ์ + โค้ดเต็ม)
      // ถ้าโชว์ไว้ นักเรียนจะเห็นคำตอบตั้งแต่ต้น = ทำแบบไม่ได้ผลจริง
      // แต่ต้องรักษาข้อความโจทย์ที่ถูกปนอยู่ในบล็อกโค้ดไว้ มิฉะนั้นข้อมูลจริงจะหาย
      rendered = stripCodeKeepThai(rendered)
        .replace(/`{3,}[^\n]*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 2000);

      // กันบทวิเคราะห์ (Input/Output/Process/รหัสเทียม) หลุดเข้าโจทย์ — มีโจทย์จริงก่อนส่วนวิเคราะห์ = ตัดออก
      // "" = ทั้งก้อนเป็นบทวิเคราะห์ล้วน -> ให้ fromSource ด้านล่างมาแทน (ห้ามคงบทวิเคราะห์ไว้เป็นโจทย์)
      const cleanRendered = stripAnalysis(rendered);
      if (cleanRendered !== rendered) rendered = cleanRendered;

      // AI บางทีสรุปจน "ข้อมูลจริง" ของโจทย์หายไปเหลือแต่คำสั่งว่าให้ทำอะไร
      // ถ้าสั้นผิดปกติเมื่อเทียบกับต้นฉบับ = ใช้ต้นฉบับที่ตัดโค้ดแล้วแทน ข้อมูลต้องไม่หาย
      // ต้องตัดบทวิเคราะห์ออกจากต้นฉบับด้วย ไม่งั้นเฉลย/บทวิเคราะห์จะถูกดันกลับมาเป็นโจทย์
      // โหมดฝึกทำรหัสเทียม: ห้ามเอาเนื้อหาดิบทับ — ต้นทางมักเป็นคำตอบ/โค้ดสำเร็จรูป
      // ที่ AI เพิ่งแปลงเป็นคำถามไปแล้ว ถ้าทับกลับ = เห็นเฉลยตั้งแต่ก่อนทำเหมือนเดิม
      if (!pseudoPractice) {
        const fromSource = stripAnalysis(stripCodeKeepThai(chosen.text)).trim();
        if (fromSource.length > rendered.length + 80) {
          rendered = fromSource.slice(0, 2000);
        }
      }

      // คำสั่งโจทย์ท้ายสุด ("จงเขียนโปรแกรม...") ห้ามหาย — AI บางรอบตัดทิ้ง = โจทย์ไม่รู้ว่าให้ทำอะไร
      const rawTaskLine = findTaskLine(chosen.text);
      if (rawTaskLine && !codeTaskAlreadyIncluded(rendered, rawTaskLine)) {
        rendered = rendered.trim() + "\n\n" + rawTaskLine;
      }
      // worked example ไม่มีบรรทัด "จง..." — task จริงอยู่ที่หัวข้อ เช่น "ตัวอย่างที่ 3.2 เขียนโปรแกรม..."
      // ห้ามหายไปกับ AI (กันเฉพาะเมื่อ rendered ไม่มี task/หัวข้อใด ๆ แล้วจริง ๆ ไม่งั้นจะทับ variant)
      if (!hasTaskLike(rendered)) {
        const head = findHeadTitle(chosen.text);
        if (head && !rendered.includes(head.slice(0, 25))) rendered = head + "\n" + rendered;
      }

      if (Array.isArray(result?.deliverables)) {
        deliverables = result.deliverables.map(String).filter(Boolean).slice(0, 8);
      }
      // เผื่อ AI แยก deliverables มาจากโค้ดที่เพิ่งตัดไป ให้เดาจากโจทย์ที่เหลือแทน
      if (!deliverables.length) deliverables = detectDeliverables(rendered);
      if (Array.isArray(result?.deliverables)) {
        deliverables = result.deliverables.map(String).filter(Boolean).slice(0, 8);
      }
      if (format === "options" && Array.isArray(result?.options)) {
        options = result.options
          .slice(0, 4)
          .map((o: any) => ({ text: String(o?.text || "").slice(0, 200), correct: !!o?.correct, explain: o?.explain ? String(o.explain) : undefined }))
          .filter((o: any) => o.text);
      }
    } catch (error) {
      console.warn("จัดรูปแบบโจทย์ไม่สำเร็จ ใช้ข้อความดิบ", String(error));
    }

    // AI แต่งโจทย์ไม่สำเร็จในโหมดฝึก — ต้นทางอาจเป็นโค้ด/เฉลยสำเร็จรูป ห้ามเอามาโชว์ดิบ
    // (ผู้เรียนจะเห็นเฉลยตั้งแต่ก่อนทำ) -> ตัดโค้ด/บทวิเคราะห์ออกก่อน ยังมีโค้ดปนอยู่จริง = ให้กดสุ่มใหม่
    if (pseudoPractice && !aiRendered) {
      const safeRaw = stripAnalysis(stripCodeKeepThai(chosen.text)).trim();
      if (!safeRaw || isRealCodeProblem(safeRaw, hasCode)) {
        return res.status(503).json({
          error: "AI ยังแต่งโจทย์ข้อนี้ไม่ได้ — กดสุ่มข้อใหม่อีกครั้ง",
          hint: "ระบบ AI อาจยังไม่พร้อมชั่วคราว",
        });
      }
      rendered = safeRaw.slice(0, 2000);
    }

    if (format === "code") {
      // โจทย์โค้ดต้องมาจากไฟล์จริงโดยตรง ห้ามให้โมเดลแต่งตัวอย่าง/ตัวเลข/ผลลัพธ์เพิ่ม
      const sourceQuestion = cleanCodeQuestion(chosen.text);
      rendered = isProgrammingTask(sourceQuestion) ? sourceQuestion : cleanCodeQuestion(rendered);
      if (!isProgrammingTask(rendered)) rendered = cleanCodeQuestion(chosen.text);
      if (!isProgrammingTask(rendered)) {
        return res.status(422).json({ error: "โจทย์ต้นทางไม่ใช่โจทย์เขียนโปรแกรมที่ชัดเจน", hint: "เลือกไฟล์ช่วงต้นที่มีแบบฝึกเขียนโปรแกรม ตัวแปร และคำสั่งรับ/แสดงผล" });
      }
      deliverables = ["โปรแกรมที่ทำตามโจทย์"];
    }

    // ถ้า AI ไม่ได้แยกให้ ให้เดาจากคำในโจทย์เอง
    if (!deliverables.length) deliverables = detectDeliverables(rendered);

    res.json({
      format,
      formats,
      problem: tidyProblem(rendered),
      options,
      deliverables,
      source: chosen.source,
      // คีย์จาก "ข้อความดิบ" ต้นฉบับ — ลูกค้าส่งกลับมาใน seen เพื่อกันข้อซ้ำ
      // (โจทย์ที่ AI แต่งใหม่คนละคำนำหน้ากับต้นฉบับ ถ้าเทียบด้วยข้อความที่แสดงจะไม่ตรงเลย)
      rawKey: problemKey(chosen.source.materialId, chosen.text),
      totalProblems: wanted === "code"
        ? onlyMaterial ? allCodeCandidates.filter((candidate: any) => candidate.source.materialId === onlyMaterial).length : allCodeCandidates.length
        : candidates.length,
      generatedByAi: rendered !== chosen.text,
      variant: !!req.body?.variant,
      // true = ไม่เจอข้อระดับที่เลือกในไฟล์นี้ -> AI ต่อยอดข้อที่มีให้ตรงระดับแทน (แจ้งผู้ใช้เบา ๆ บนจอ)
      levelFallback,
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});


/* ------------------------------------------------------------------ */
/*  วิเคราะห์โจทย์ — แยกจากตัวโจทย์ ผู้เรียนกดดูแนวทางเองตอนอยากดู        */
/*  คืนบทวิเคราะห์ทั้งก้อน: Input / Output / Process / ตัวแปร / ค่าเริ่มต้น   */
/*  / รหัสเทียม  (ไม่ปนกับโจทย์ ไม่ใช่คำตอบสำเร็จรูป)                      */
/* ------------------------------------------------------------------ */
router.post("/diagnose/analyze", requireAuth(), async (req: any, res) => {
  const problem = String(req.body?.problem || "").trim().slice(0, 4000);
  const subjectId = String(req.body?.subjectId || "").trim();
  if (!problem) return res.status(400).json({ error: "ไม่มีโจทย์ให้วิเคราะห์" });

  let subjectName = "";
  if (subjectId) {
    const s = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id }, select: { name: true } });
    if (s) subjectName = s.name;
  }

  try {
    const result: any = await llm(
      [
        {
          role: "system",
          content:
            'คุณคืออาจารย์ผู้ช่วย ส่วน "วิเคราะห์โจทย์" ให้นักเรียนดูเป็นแนวทางทำแบบฝึกหัด (ไม่ใช่คำตอบสำเร็จรูป)\n' +
            "ตอบเป็น JSON เท่านั้น ไม่มีข้อความนอก JSON รูปแบบ:\n" +
            '{"input":["..."],"output":["..."],"process":["..."],"variables":["..."],"initial":["..."],"pseudocode":"..."}\n' +
            '- input: ข้อมูลนำเข้าของโจทย์ แต่ละบรรทัดเป็น 1 รายการ เช่น "N = จำนวนตัวเลขทั้งหมด"\n' +
            '- output: ข้อมูลที่ต้องแสดงออก เช่น "max = ค่าที่มากที่สุด"\n' +
            "- process: ขั้นตอนการทำงานโดยรวม เป็น bullet สั้น ๆ ตามลำดับ\n" +
            '- variables: ตัวแปรที่ใช้ในโจทย์ เช่น "i = ตัวเลขแสดงรอบที่"\n' +
            '- initial: ค่าเริ่มต้นของตัวแปร เช่น "i = 0"\n' +
            "- pseudocode: รหัสเทียมของโจทย์นี้ เป็นข้อความหลายบรรทัด ไม่ใส่ ``` ไม่ใส่คำอธิบาย\n" +
            "ทุกหัวข้อต้องมาจากโจทย์ที่ให้มาเท่านั้น ห้ามแต่งเพิ่ม ห้ามมีคำทักทาย/สรุป/คำถาม",
        },
        { role: "user", content: (subjectName ? "วิชา: " + subjectName + "\n" : "") + "โจทย์:\n" + problem },
      ],
      { json: true, temperature: 0.4 }
    );

    const arr = (v: any): string[] =>
      Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];
    const out = {
      input: arr(result?.input),
      output: arr(result?.output),
      process: arr(result?.process),
      variables: arr(result?.variables),
      initial: arr(result?.initial),
      pseudocode:
        typeof result?.pseudocode === "string"
          ? result.pseudocode.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "").trim()
          : "",
    };

    if (!out.input.length && !out.output.length && !out.process.length && !out.pseudocode) {
      return res.status(502).json({ error: "AI ยังร่างบทวิเคราะห์ไม่สำเร็จ ลองอีกครั้ง" });
    }
    res.json(out);
  } catch (e: any) {
    console.warn("วิเคราะห์โจทย์ไม่สำเร็จ", String(e?.message || e));
    res.status(502).json({ error: "วิเคราะห์โจทย์ไม่สำเร็จ ลองอีกครั้ง" });
  }
});


router.post("/diagnose/answer", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const problem = String(req.body?.problem || "").slice(0, 3000);
    const answer = String(req.body?.answer || "").slice(0, 3000);
    const answerFmt = String(req.body?.format || "");
    const deliverables: string[] = answerFmt === "code"
      ? ["โปรแกรมที่ทำตามโจทย์"]
      : Array.isArray(req.body?.deliverables) ? req.body.deliverables.map(String).slice(0, 8) : [];
    const done: string[] = answerFmt === "code"
      ? deliverables
      : Array.isArray(req.body?.done) ? req.body.done.map(String) : [];
    // แนวคำตอบที่ผู้เรียนใช้ตอบ — รหัสเทียมต้องตรวจคนละแบบกับโค้ดจริง
    if (!subjectId || !problem) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });

    let feedback: any = {
      correct: false,
      score: 0,
      points: [],
      fix: "ตรวจแล้ว คำตอบนี้ยังไม่ครบ ลองทำใหม่ตามโจทย์ทีละขั้น",
      lines: [],
    };
    if (answer.trim().length > 0) {
      try {
        const r: any = await llm(
          [
            {
              role: "system",
              content:
                "คุณคืออาจารย์ที่ตรวจงานนักเรียน ตอบสั้นกระชับภาษาไทย ห้ามพูดเกริ่นนำ " +
                (answerFmt === "pseudocode"
                  ? "คำตอบเป็นรหัสเทียม (pseudocode) — ตรวจลำดับขั้นตอนและตรรกะ (การรับข้อมูล/ประมวลผล/แสดงผล, จุดเริ่มต้น-จุดจบ, IF/ELSE, WHILE/FOR, ตัวแปร) เทียบกับวิธีที่ถูกต้อง ไม่ต้องติดไวยากรณ์ของภาษาโปรแกรมจริง " +
                    "รหัสเทียมที่ถูกต้องต้องขึ้นต้นด้วย start (จุดเริ่มต้น) และลงท้ายด้วย stop (จุดสิ้นสุด) ถ้าขาดหรือผิดลำดับให้ระบุเป็นจุดที่ต้องแก้ "
                  : answerFmt === "code"
                    ? "คำตอบเป็นโปรแกรม ให้ตรวจเฉพาะว่าโค้ดทำงานตามโจทย์ รับข้อมูล/ประมวลผล/แสดงผลตรงตามที่ระบุหรือไม่ ห้ามเรียก pseudocode ผังงาน ขั้นตอนวิธี หรือคำอธิบายที่อยู่ในเอกสารต้นทางว่าเป็นสิ่งที่ผู้เรียนต้องส่งเพิ่ม เพราะกำลังตรวจโหมดโค้ด " +
                      "ไม่เทียบรูปแบบการเขียนหรือชื่อไลบรารี ยอมรับ cout/cin แทน printf/scanf เมื่อรับและแสดงผลถูกต้องเหมือนกัน ห้ามบังคับเปลี่ยนเป็น printf เว้นแต่โจทย์ระบุชัดว่าต้องใช้ printf โดยเฉพาะ " +
                      "ถ้าโค้ดครบตามข้อกำหนดและผลลัพธ์ถูกต้อง ต้องให้คะแนนผ่าน แม้เลือกวิธีเขียนต่างจากตัวอย่าง"
                    : "คำตอบเป็นข้อความ ให้เทียบเนื้อหากับโจทย์และยอมรับคำตอบที่ถูกต้องแม้ใช้คำอธิบายต่างกัน") +
                (deliverables.length
                  ? "โจทย์นี้สั่งให้ส่ง " + deliverables.length + " ส่วน ต้องครบทุกส่วนถึงจะถือว่าถูก: " + deliverables.join(" / ") + "\n"
                  : "") +
                "สรุปทุกครั้งให้ครบทั้ง 4 อย่าง: correct = ถูก/ผิด, score = ทำได้ดีแค่ไหน (0-100), " +
                "points = จุดที่ทำได้ดี, fix = ผิดตรงไหนและควรแก้ไขอย่างไร (รวมวิธีทำที่ดีที่สุดสำหรับข้อนี้)\n" +
                "และใส่ lines = รายการบรรทัดในคำตอบนักเรียนที่ผิด (นับบรรทัดจาก 1 ตามที่ตอบมาจริง): " +
                '[{"line":n,"why":"ทำไมบรรทัดนี้ผิด","fix":"ควรแก้เป็นอะไร"}] ถ้าไม่มีบรรทัดผิดให้เป็น [] และใส่เฉพาะบรรทัดที่ผิดจริงเท่านั้น\n' +
                "ตอบเป็น JSON: {\"correct\":true/false,\"score\":0-100,\"points\":[\"...จุดที่ทำได้ดี...\"],\"fix\":\"ผิดตรงไหน + ควรทำอย่างไร\",\"lines\":[{\"line\":n,\"why\":\"...\",\"fix\":\"...\"}]}",
            },
            { role: "user", content: "โจทย์:\n" + problem + "\n\nคำตอบนักเรียน:\n" + answer },
          ],
          { json: true, temperature: 0.3, model: SPEED.balanced.model }
        );
        // llm() คืน object อยู่แล้วตอน json:true — ห้าม String() ทับไม่งั้นกลายเป็น [object Object]
        if (r && typeof r === "object" && typeof r.correct === "boolean") {
          feedback = {
            correct: r.correct,
            score: Number(r.score) || 0,
            points: Array.isArray(r.points) ? r.points.map(String).slice(0, 6) : [],
            fix: String(r.fix || "").slice(0, 400),
            // บรรทัดที่ผิดในคำตอบผู้เรียน (เรียงตามบรรทัดจริง) — ใช้ขึ้นจอว่า "บรรทัดไหน แก้ยังไง"
            lines: Array.isArray(r.lines)
              ? r.lines
                  .map((l: any) => ({
                    line: Number(l?.line) || 0,
                    why: String(l?.why || "").slice(0, 200),
                    fix: String(l?.fix || "").slice(0, 300),
                  }))
                  .filter((l: any) => l.why || l.fix)
                  .slice(0, 12)
              : [],
          };
        }
      } catch { /* ใช้ผลสำรอง */ }
    }

    // ข้อที่นักเรียนยังไม่ได้ทำ — รายงานกลับไปด้วย
    const missing = deliverables.filter((d) => !done.includes(d));
    res.json({ feedback, missing, doneCount: done.length, deliverableCount: deliverables.length, checkedAt: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* สร้างโค้ดตามโจทย์ปัจจุบัน ไม่อาศัยประวัติแชตที่อาจเป็นคนละข้อ */
router.post("/diagnose/code-solution", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const problem = String(req.body?.problem || "").trim().slice(0, 3000);
    const studentCode = String(req.body?.answer || "").trim().slice(0, 5000);
    const materialId = String(req.body?.materialId || "").trim();
    if (!subjectId || problem.length < 12) return res.status(400).json({ error: "ไม่พบโจทย์ที่ต้องการช่วยเขียนโค้ด" });
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, userId: req.user.id },
      select: {
        id: true,
        name: true,
        materials: { select: { id: true, title: true, textContent: true } },
      },
    });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });
    const validMaterials = materialsForSubject(subject);
    const lesson = materialId ? validMaterials.find((material) => material.id === materialId) : null;
    if (!lesson) return res.status(404).json({ error: "ไม่พบไฟล์เรียนจริงของโจทย์นี้ จึงยังไม่สร้างโค้ดจากแหล่งอื่น" });
    const lessonContext = buildCodeLessonReference(validMaterials, materialId, problem);
    if (!lessonContext.reference) return res.status(422).json({ error: "ไม่พบตัวอย่างคำสั่งที่เกี่ยวข้องในไฟล์เรียนของโจทย์นี้" });
    const languageRule = lessonContext.language === "C"
      ? "ไฟล์บทเรียนนี้ใช้ภาษา C และสไตล์ stdio; ให้เขียน C99 โดยใช้เฉพาะรูปแบบที่เห็นในตัวอย่าง (เช่น scanf/printf เมื่อมีการรับหรือแสดงผล) ห้ามใช้ cin, cout, iostream, using namespace std หรือไวยากรณ์ C++"
      : "ไฟล์บทเรียนนี้ใช้ภาษา C++; ให้เขียน C++ ตามรูปแบบที่เห็นในตัวอย่าง ห้ามสลับไปใช้ภาษา/ไลบรารีที่ไม่ได้สอน";
    const result: any = await llm([
      { role: "system", content: "คุณเป็นผู้ช่วยเขียนโปรแกรมสำหรับผู้เรียน ตอบ JSON ที่มี code เป็นสตริงเดียวเท่านั้น. " +
        "เขียนโปรแกรมที่แก้โจทย์ที่แนบมาโดยตรง ห้ามอาศัยโจทย์หรือบริบทจากข้ออื่น. " +
        "อ่านทุกเงื่อนไขและค่าตัวเลขก่อนเขียน ต้องรับข้อมูลและแสดงผลตรงตามโจทย์. " +
        "ห้ามเดาหรือแต่งข้อความแสดงผลที่โจทย์ไม่ระบุ ถ้าโจทย์บอกเพียงแนวคิด ให้ใช้คำสั้น ๆ ในภาษาเดียวกับโจทย์. " +
        "Use only the data types, variables, and commands demonstrated in the attached lesson excerpts and earlier prerequisite lesson excerpts; do not introduce libraries or algorithms absent from them. " +
        languageRule + " ประกาศตัวแปรทุกตัวก่อนใช้ เลือกชนิดและขนาดอาร์เรย์ตรงกับโจทย์. " +
        "ตัวอย่างในบทเรียนเป็นหลักฐานเฉพาะเรื่องไวยากรณ์/คำสั่ง ห้ามคัดลอกโจทย์ ตัวเลข ผลลัพธ์ หรือตัวแปรของตัวอย่างอื่นมาใช้ เว้นแต่โจทย์ปัจจุบันระบุเหมือนกัน. " +
        "ตรวจโค้ดกับตัวอย่าง Input/Output ในโจทย์ก่อนส่ง. โค้ดต้องสมบูรณ์ ไม่มี URL markdown fence หรือคำอธิบายปนใน code. " +
        "ถ้ามีโค้ดที่ผู้เรียนเขียนมา ให้ตรวจและแก้ให้ตรงโจทย์ ไม่เขียนซ้ำจากงานคนละข้อ. รูปแบบ: {\"code\":\"...\"}" },
      { role: "user", content: `วิชา: ${subject.name}\nโจทย์ปัจจุบัน (ข้อกำหนดที่ต้องทำตาม):\n${problem}\n\nข้อความที่คัดจากไฟล์เรียนจริงและบทเรียนพื้นฐานก่อนหน้า (ใช้ดูเฉพาะไวยากรณ์และคำสั่งที่สอน):\n${lessonContext.reference}\n\nโค้ดที่ผู้เรียนมี:\n${studentCode || "(ยังไม่มี)"}` },
    ], { json: true, temperature: 0.1, model: SPEED.balanced.model });
    const code = String(result?.code || "").trim().replace(/^```[a-zA-Z+#]*\s*/, "").replace(/\s*```$/, "").trim();
    if (code.length < 20) return res.status(502).json({ error: "ยังสร้างโค้ดที่ใช้ได้สำหรับโจทย์นี้ไม่ได้ ลองอีกครั้ง" });
    if (lessonContext.language === "C" && /\b(?:cin|cout)\b|iostream|using\s+namespace\s+std|std::/.test(code)) {
      return res.status(502).json({ error: "โค้ดที่สร้างไม่ตรงกับภาษา C ที่สอนในไฟล์นี้ ลองขอคำใบ้ใหม่อีกครั้ง" });
    }
    res.json({ code });
  } catch (error) {
    console.warn("สร้างโค้ดตามโจทย์ไม่สำเร็จ", String(error));
    res.status(502).json({ error: "สร้างโค้ดตามโจทย์ไม่สำเร็จ ลองอีกครั้ง" });
  }
});

/* ------------------------------------------------------------------ */
/* คำใบ้ในโหมดฝึกทำรหัสเทียม — ใบ้ทีละขั้น ไม่บอกเฉลย                  */
/* (ส่งคำใบ้เดิมกลับมาด้วยทุกครั้ง เพื่อให้ใบ้ถัดไปลึกขึ้นและไม่ซ้ำ)   */
/* ------------------------------------------------------------------ */
router.post("/diagnose/hint", requireAuth(), async (req: any, res) => {
  try {
    const problem = String(req.body?.problem || "").slice(0, 3000);
    const answer = String(req.body?.answer || "").slice(0, 3000);
    const prev: string[] = Array.isArray(req.body?.prev) ? req.body.prev.map(String).slice(0, 8) : [];
    if (!problem) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });

    const hint = await llm(
      [
        {
          role: "system",
          content:
            "คุณคืออาจารย์ผู้ช่วยสอนการเขียนรหัสเทียม ตอบภาษาไทยสั้น ๆ ไม่เกริ่นนำ ไม่ทักทาย " +
            "หน้าที่: ให้ \"คำใบ้\" ขั้นถัดไปแก่ผู้เรียนที่กำลังติดโจทย์นี้ — ใบ้แนวทางเท่านั้น ห้ามบอกเฉลย " +
            "ห้ามเขียนรหัสเทียมที่สมบูรณ์ให้เห็นทั้งหมด " +
            "ให้บอกแค่ว่าขั้นต่อไปควรทำอะไรก่อน (เช่น เริ่มจากรับข้อมูลอะไร ใช้ลูปหรือเงื่อนไขอะไร ต้องแสดงผลอะไร) " +
            "ตอบเป็นข้อความล้วน ๆ ห้ามใช้เครื่องหมาย LaTeX เช่น $...$ ห้ามใช้บล็อก ``` หรือตัวหนา ** " +
            "ยาวไม่เกิน 3 ประโยค" +
            (prev.length
              ? "\nคำใบ้ที่เคยให้ไปแล้ว — ห้ามซ้ำ ต้องลึกขึ้นเรื่อย ๆ:\n" + prev.map((h, i) => `${i + 1}. ${h}`).join("\n")
              : ""),
        },
        { role: "user", content: "โจทย์:\n" + problem + "\n\nคำตอบที่ผู้เรียนเขียนไว้:\n" + (answer.trim() || "(ยังไม่ได้เขียน)") },
      ],
      { temperature: 0.6 }
    );
    const text = String(hint || "")
      // AI บางรอบยังส่งสัญลักษณ์คณิตศาสตร์/โค้ดมาเอง — ล้างออกให้เป็นข้อความล้วนอ่านง่ายบนจอ
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/`{1,3}/g, "")
      .trim();
    if (!text) return res.status(502).json({ error: "AI ยังร่างคำใบ้ไม่สำเร็จ ลองอีกครั้ง" });
    res.json({ hint: text.slice(0, 800) });
  } catch (error) {
    console.warn("ขอคำใบ้ไม่สำเร็จ", String(error));
    res.status(502).json({ error: "ขอคำใบ้ไม่สำเร็จ ลองอีกครั้ง" });
  }
});

/* ------------------------------------------------------------------ */
/* 2) แผนการเรียน — อ่านหัวข้อจากเนื้อหาจริงแล้วจัดลำดับ                */
/* ------------------------------------------------------------------ */

router.post("/plan", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id }, include: { materials: true } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    const rows = subject.materials
      .filter((m: any) => (m.textContent || "").trim().length >= 40 || m.filePath)
      .slice(0, 40)
      .map((m: any) => {
        const date = m.externalUpdatedAt ? new Date(m.externalUpdatedAt).toLocaleDateString("th-TH") : "";
        return `[${date}] ${m.title} (${m.mimeType || ""})\n${String(m.textContent || "").slice(0, 400)}`;
      });

    if (!rows.length) return res.json({ topics: [], recommendation: "ยังไม่มีเนื้อหาพอสร้างแผนการเรียน กรุณาซิงก์จาก Google Classroom ก่อน", materialCount: 0 });

    let result: any = null;
    try {
      result = await llm(
        [
          {
            role: "system",
            content:
              'วิเคราะห์รายการเอกสารของวิชาแล้วจัดแผนการเรียน ตอบเป็น JSON เท่านั้น รูปแบบ: ' +
              '{"topics":[{"title":"...","summary":"...","level":"พื้นฐาน|กลาง|สูง","order":1,"reason":"..."}],' +
              '"recommendation":"คำแนะนำภาพรวมว่าเริ่มที่ไหนและข้ามอะไรได้"} ' +
              'สั่งแบ่งเป็น 4-8 หัวข้อ เรียงตามลำดับที่ควรเรียน',
          },
          { role: "user", content: "เอกสารในวิชา:\n" + rows.join("\n\n") },
        ],
        { json: true, temperature: 0.3 }
      );
    } catch (error) {
      console.warn("สร้างแผนการเรียนไม่สำเร็จ ใช้รายการเอกสารแทน", String(error));
    }

    if (!result || !Array.isArray(result.topics)) {
      const topics = subject.materials.slice(0, 12).map((m: any, i: number) => ({
        title: m.title,
        summary: String(m.textContent || "").slice(0, 160),
        level: "กลาง",
        order: i + 1,
        reason: "มาจากเอกสารในวิชา",
      }));
      return res.json({ topics, recommendation: "ยังไม่ได้เชื่อมต่อ AI — แสดงรายการเอกสารตามลำดับเวลา", materialCount: subject.materials.length, generatedByAi: false });
    }

    res.json({ topics: result.topics, recommendation: String(result.recommendation || ""), materialCount: subject.materials.length, generatedByAi: true });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* ------------------------------------------------------------------ */
/* 3) ระบบข้อสอบ — สร้างจากเนื้อหาจริง แล้ววัดผลว่าจุดอ่อนอยู่ตรงไหน   */
/* ------------------------------------------------------------------ */

/**
 * เก็บเฉลยไว้ฝั่งเซิร์ฟเวอร์ชั่วคราว
 *
 * เดิม /diagnose ตัด field "answer" ทิ้งก่อนส่งให้ client แต่ /diagnose/evaluate
 * กลับเอา answer จาก body ที่ client ส่งมา -> ได้ undefined -> NaN -> ได้ 0 เสมอ
 * ย้ายเฉลยมาเก็บที่นี่แทน ทั้งตรวจถูกต้องและไม่ต้องกลัวเลขลำดับเพี้ยนหลังลบตัวเลือกซ้ำ
 */
type StoredQuiz = { answers: number[]; questions: any[]; expires: number };
const quizStore = new Map<string, StoredQuiz>();
const QUIZ_TTL_MS = 2 * 60 * 60 * 1000; // 2 ชั่วโมง

function saveQuiz(answers: number[], questions: any[]) {
  const quizId = crypto.randomBytes(12).toString("hex");
  quizStore.set(quizId, { answers, questions, expires: Date.now() + QUIZ_TTL_MS });
  // ตัดของเก่าทิ้งเป็นระยะ
  if (quizStore.size > 200) {
    for (const [k, v] of quizStore) if (v.expires < Date.now()) quizStore.delete(k);
  }
  return quizId;
}

function readQuiz(quizId: string): StoredQuiz | null {
  if (!quizId) return null;
  const hit = quizStore.get(quizId);
  if (!hit) return null;
  if (hit.expires < Date.now()) { quizStore.delete(quizId); return null; }
  return hit;
}
router.post("/diagnose", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const difficulty = pickDifficulty(req.body?.difficulty);
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id }, include: { materials: true } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    // เน้นเฉพาะหัวข้อที่นักเรียนเลือก (ถ้าส่งมา) มิฉะนั้นทั้งวิชา
    const onlyTopics: string[] = Array.isArray(req.body?.topics)
      ? req.body.topics.map(String).filter(Boolean).slice(0, 6)
      : [];

    const rows = subject.materials
      .map((m: any) => ({ m, text: String(m.textContent || "").trim() }))
      .filter((x: any) => x.text.length >= 40 || x.m.filePath)
      .slice(0, 30)
      .map((x: any) => `เอกสาร: ${x.m.title}\n${x.text.slice(0, 500) || "(เป็นไฟล์แนบ เช่น รูปภาพสไลด์/วิดีโอ — ให้ถามในสิ่งที่มักถามกันในหัวข้อนี้)"}`);

    if (!rows.length) return res.status(400).json({ error: "วิชานี้ยังไม่มีเนื้อหาพอทำแบบทดสอบ" });

    let quiz: any = null;
    try {
      quiz = await llm(
        [
          {
            role: "system",
            content:
              'สร้างข้อสอบจากเนื้อหาที่ให้มา ตอบเป็น JSON เท่านั้น รูปแบบ: ' +
              '{"questions":[{"question":"...","options":["..."],"answer":0,"topic":"...","explain":"..."}]} ' +
              (onlyTopics.length ? `ให้ถามเฉพาะหัวข้อเหล่านี้: ${onlyTopics.join(", ")} ` : "") +
              'ทำ 5 ข้อ ปนกันระดับง่าย-กลาง แต่ละข้อต้องมีตัวเลือก 4 ตัวเลือกและคำอธิบายเฉลย ' +
              "ห้ามถามเรื่องที่ไม่มีในเอกสารที่ให้มา " +
              "ถ้าเอกสารเป็นไฟล์แนบที่ไม่มีข้อความ (สไลด์/รูป) ให้ถามเกี่ยวกับแนวคิดหลักของหัวข้อนั้นตามความรู้ทั่วไปของสาขาที่ปรากฏในชื่อวิชา " +
              "แต่ต้องอยู่ในขอบเขตของชื่อหัวข้อนั้น ห้ามออกนอกเนื้อหาวิชา " +
              DIFFICULTY[difficulty].instruction.slice(0, 60),
          },
          { role: "user", content: "ชื่อวิชา: " + subject.name + "\nเนื้อหาในวิชา:\n" + rows.join("\n\n") },
        ],
        { json: true, temperature: 0.5 }
      );
    } catch (error) {
      console.warn("สร้างข้อสอบไม่สำเร็จ", String(error));
    }

    if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) {
      return res.status(400).json({ error: "สร้างข้อสอบไม่สำเร็จ ลองตรวจว่า AI_API_KEY ตั้งค่าถูกต้องหรือยัง" });
    }
    // รวมตัวเลือกที่ซ้ำให้เหลือตัวเดียว แล้วเลื่อนเลขลำดับเฉลยให้ตรงกับตัวเลือกใหม่
    const cleaned = quiz.questions.slice(0, 8).map((q: any) => {
      const rawOptions = Array.isArray(q.options) ? q.options.map(String) : [];
      let answerIndex = Number(q.answer);
      // ถ้า AI ตอบเป็นข้อความเฉลยแทนเลขลำดับ ให้หาเลขลำดับจากข้อความนั้น
      if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= rawOptions.length) {
        const target = String(q.answer ?? "").trim().toLowerCase();
        answerIndex = rawOptions.findIndex((o: string) => String(o).trim().toLowerCase() === target);
      }
      const { options, answerIndex: fixed } = dedupeOptions(rawOptions, answerIndex);
      return {
        question: String(q.question || ""),
        options,
        answerIndex: fixed,
        topic: String(q.topic || ""),
        explain: String(q.explain || ""),
      };
    });

    let merged = 0;
    quiz.questions.slice(0, 8).forEach((q: any) => {
      const raw = Array.isArray(q.options) ? q.options.map(String) : [];
      merged += Math.max(0, raw.length - dedupeOptions(raw, 0).options.length);
    });

    // เก็บเฉลยไว้ฝั่งเซิร์ฟเวอร์ ไม่ส่งให้ client
    const quizId = saveQuiz(cleaned.map((q: any) => q.answerIndex), cleaned);

    res.json({
      quizId,
      questions: cleaned.map((q: any) => ({ question: q.question, options: q.options, topic: q.topic })),
      difficulty,
      focused: onlyTopics,
      duplicatesMerged: merged,
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* ส่งคำตอบกลับมาให้วิเคราะห์ — บอกว่าเน้นอะไร ข้ามอะไรได้ */

router.post("/diagnose/evaluate", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!subjectId || !questions.length) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });

    // เฉลยต้องมาจาก quizId ที่ฝั่งเซิร์ฟเวอร์เก็บไว้ ไม่งั้นจะเป็น NaN และได้ 0 เสมอ
    const stored = readQuiz(String(req.body?.quizId || ""));
    const keyOf = stored ? stored.answers : questions.map((q: any) => Number(q.answer));

    const results: any[] = questions.map((q: any, i: number) => {
      const key = Number(keyOf[i]);
      const chosen = Number(answers[i] ?? -1);
      const options = Array.isArray(q.options) ? q.options.map(String) : [];
      return {
        question: q.question,
        topic: q.topic,
        options,
        answer: options[key] ?? "",
        chosen: chosen >= 0 && chosen < options.length ? options[chosen] : "",
        chosenIndex: chosen,
        correct: key >= 0 && chosen === key,
        explain: stored?.questions?.[i]?.explain || q.explain || "",
      };
    });

    const total = results.length;
    const correct = results.filter((r) => r.correct).length;
    const byTopic: Record<string, { correct: number; total: number }> = {};
    for (const r of results) {
      const k = r.topic || "ทั่วไป";
      byTopic[k] = byTopic[k] || { correct: 0, total: 0 };
      byTopic[k].total++;
      if (r.correct) byTopic[k].correct++;
    }
    const weak = Object.entries(byTopic).filter(([, v]) => v.correct / v.total < 0.7).map(([k, v]) => ({ topic: k, score: v.correct / v.total }));
    const strong = Object.entries(byTopic).filter(([, v]) => v.correct / v.total >= 0.7).map(([k, v]) => ({ topic: k, score: v.correct / v.total }));

    let advice = "";
    try {
      const score = Math.round((correct / Math.max(1, total)) * 100);
      const detail = results.map((r, i) => `${i + 1}. ${r.topic}: ตอบ${r.correct ? "ถูก" : "ผิด"} — ${r.explain}`).join("\n");
      advice = String(
        await llm([
          {
            role: "system",
            content:
              "คุณคืออาจารย์ที่ประเมินผลการเรียน ตอบภาษาไทย สั้นกระชับ บอกว่า (1) จุดที่ต้องเน้น (2) หัวข้อที่แข็งแรงแล้วข้ามได้ (3) ลำดับการศึกษาต่อ",
          },
          { role: "user", content: `คะแนน ${score}/100 (${correct}/${total})\n\n${detail}` },
        ]) || ""
      );
    } catch { /* ใช้คำแนะนำจากสถิติแทน */ }

    res.json({
      score: Math.round((correct / Math.max(1, total)) * 100),
      correct,
      total,
      results,
      weak,
      strong,
      advice: advice || (weak.length ? `ควรเน้น: ${weak.map((w) => w.topic).join(", ")}` : "พื้นฐานดีแล้ว ลองข้ามไปหัวข้อถัดไปได้"),
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* ------------------------------------------------------------------ */
/* 0) เปิดบทสนทนา — ถามก่อนว่าต้องการให้ช่วยเรื่องไหน                    */
/* ------------------------------------------------------------------ */

/**
 * สิ่งที่ช่วยได้จริงสำหรับวิชานั้น
 *
 * เดิมส่ง 3 ปุ่มตายตัวทุกวิชา -> วิชาอังกฤษก็ได้ปุ่ม "เขียนโค้ด" แล้ว AI ตอบเป็น Python
 * ทั้งที่ไม่มีสักบรรทัดโค้ดในวิชา ตอนนี้เลือกจากหัวข้อที่สแกนเจอจริงแทน
 */
const SUBJECT_CHOICES: Record<string, { key: string; icon: string; label: string; prompt: string; sub: string }[]> = {
  programming: [
    { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายหัวข้อทั้งหมดในวิชานี้ให้ฟังแบบเป็นขั้นตอน พร้อม flowchart", sub: "ไล่เรียงทีละหัวข้อ" },
    { key: "code", icon: "code-slash", label: "โค้ด", prompt: "เขียนโค้ดที่ถูกต้องและใช้งานได้จริงจากเนื้อหาในวิชานี้ พร้อมอธิบายการทำงานทีละบรรทัด", sub: "เขียนเอง ตรวจได้" },
    { key: "diagram", icon: "git-branch", label: "ดูผังภาพ / ขั้นตอน", prompt: "วาด flowchart ขั้นตอนสำคัญในวิชานี้ทีละหัวข้อ", sub: "ดูง่ายกว่าอ่านตัวหนังสือ" },
  ],
  social: [
    { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายเนื้อหาในวิชานี้แบบเป็นขั้นตอน พร้อมตัวอย่างกรณีศึกษา", sub: "ไล่เรียงทีละหัวข้อ" },
    { key: "case", icon: "briefcase", label: "วิเคราะห์กรณีศึกษา", prompt: "เลือกประเด็นในเนื้อหาวิชานี้มา 1 เรื่อง แล้ววิเคราะห์เป็นกรณีศึกษาพร้อมเหตุผลและข้อสรุป", sub: "คิดเป็นระบบ" },
    { key: "compare", icon: "swap-horizontal", label: "เปรียบเทียบแนวคิด", prompt: "เปรียบเทียบแนวคิดสำคัญในวิชานี้เป็นตาราง พร้อมข้อดีข้อเสียและตัวอย่างประกอบ", sub: "เห็นความต่างชัด" },
  ],
  language: [
    { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายเนื้อหาในวิชานี้แบบเป็นขั้นตอน พร้อมตัวอย่างประโยค", sub: "ไล่เรียงทีละหัวข้อ" },
    { key: "vocab", icon: "book", label: "คำศัพท์ / แปลคำ", prompt: "สรุปคำศัพท์สำคัญในวิชานี้ พร้อมความหมาย พาร์ทของคำ และประโยคตัวอย่าง", sub: "ท่องได้เลย" },
    { key: "grammar", icon: "text", label: "ไวยากรณ์ / โครงสร้างประโยค", prompt: "อธิบายโครงสร้างไวยากรณ์ที่ใช้ในวิชานี้ พร้อมตารางเปรียบเทียบกฎและตัวอย่างที่ถูกต้อง", sub: "เห็นภาพชัดขึ้น" },
  ],
  math: [
    { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายเนื้อหาในวิชานี้ทีละขั้นตอน พร้อมตัวอย่างและสูตรที่ใช้", sub: "ไล่เรียงทีละหัวข้อ" },
    { key: "steps", icon: "list", label: "ทำโจทย์ทีละขั้น", prompt: "เลือกโจทย์จากเนื้อหาในวิชานี้มา 1 ข้อ แล้วแสดงวิธีคิดเป็นขั้นตอนพร้อมเหตุผล", sub: "ดูวิธีคิด ไม่ใช่แค่คำตอบ" },
    { key: "diagram", icon: "git-branch", label: "ดูผังภาพ / ขั้นตอน", prompt: "วาดแผนภาพอธิบายแนวคิดสำคัญในวิชานี้", sub: "ดูง่ายกว่าอ่านตัวหนังสือ" },
  ],
  // วิชาเครื่องมือสำนักงาน (Word/Excel/PowerPoint) — ไม่ใช่สายเขียนโค้ด ห้ามขึ้นปุ่ม "โค้ด"
  office: [
    { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายหัวข้อทั้งหมดในวิชานี้ให้ฟังแบบเป็นขั้นตอน พร้อมตัวอย่าง", sub: "ไล่เรียงทีละหัวข้อ" },
    { key: "compare", icon: "swap-horizontal", label: "เปรียบเทียบฟีเจอร์", prompt: "เปรียบเทียบคำสั่งหรือฟีเจอร์ที่คล้ายกันในวิชานี้ เป็นตาราง ช่องเทียบ ข้อดี ข้อเสีย และตัวอย่างประกอบ", sub: "ดูต่างกันชัด ๆ" },
  ],
  // วิชาทักษะชีวิตดิจิทัล — เน้นทำตามขั้นตอน ไม่มี flowchart/โค้ด
  digital: [
    { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายหัวข้อทั้งหมดในวิชานี้ให้ฟังแบบเป็นขั้นตอน พร้อมตัวอย่าง", sub: "ไล่เรียงทีละหัวข้อ" },
  ],
};

/** วิชาที่สอน "ทำตามขั้นตอน" เช่น ใช้ Google Docs/Forms — ขอได้ทุกวิชาไม่ต้องเป็นสายคอมฯ */
const HOWTO_CHOICE: { key: string; icon: string; label: string; prompt: string; sub: string }[] = [
  { key: "howto", icon: "walk-outline", label: "ทำตามขั้นตอน", prompt: "เลือกงานที่ต้องทำ 1 อย่างจากเนื้อหาวิชานี้ แล้วแสดงขั้นตอนทำทีละขั้นพร้อมผลลัพธ์ที่คาดว่าจะได้", sub: "ทำตามได้เลย" },
];
const GENERAL_CHOICES: { key: string; icon: string; label: string; prompt: string; sub: string }[] = [
  { key: "explain", icon: "school", label: "อธิบายเนื้อหา", prompt: "อธิบายหัวข้อทั้งหมดในวิชานี้ให้ฟังแบบเป็นขั้นตอน พร้อมตัวอย่าง", sub: "ไล่เรียงทีละหัวข้อ" },
  { key: "diagram", icon: "git-branch", label: "ดูผังภาพ / ขั้นตอน", prompt: "วาดผังภาพอธิบายขั้นตอนสำคัญในวิชานี้ทีละหัวข้อ", sub: "ดูง่ายกว่าอ่านตัวหนังสือ" },
];

/** เลือกชุดปุ่มให้ตรงกับวิชา + ตามหัวข้อที่สแกนเจอจริง */
/**
 * เงื่อนไขขั้นต่ำของแต่ละโหมด — ต้องมีหัวข้อที่สนับสนุนถึงจะขึ้นปุ่มนั้น
 * เทียบกับ "หัวข้อที่สแกนได้จริง" ไม่ใช่ชื่อวิชา
 */
const MODE_REQUIRES: Record<string, RegExp> = {
  code: /โค้ด|เขียนโปรแกรม|โปรแกรม|Input-?Process|ทางเลือก|วนซ้ำ|ฟังก์ชัน|ตารางทดสอบ/i,
  diagram: /ผัง|flowchart|โครงสร้าง(?!ไวยากรณ์)|อัลกอริทึม|ขั้นตอน|สถาปัตยกรรม|อุปกรณ์อินพุต|ฮาร์ดแวร์|บล็อกไดอะแกรม|ภาพรวมระบบ/i,
  steps: /คณิต|สูตร|โจทย์|คำนวณ|อัลกอริทึม|วิธีแก้ปัญหา|พิสูจน์|อนุกรม|ทฤษฎี/i,
  vocab: /ศัพท์|vocab|บทสนทนา|ภาษาพูด|อังกฤษ/i,
  grammar: /ไวยากรณ์|grammar|ประโยค|โครงสร้างภาษา|รูป|อดีต|ปัจจุบัน|อนาคต/i,
  case: /กฎหมาย|จริยธรรม|กรณี|สังคม|มาตรา|วินิจฉัย|ศีลธรรม|ผลกระทบ/i,
  compare: /เปรียบเทียบ|ข้อดี|ข้อเสีย|ดีเปรียบ|ความต่าง|pros|cons/i,
  howto: /การใช้งาน|วิธี(การ)?|ขั้นตอน|การทำ|การสร้าง|ตั้งค่า|การจัดการ|แบบฟอร์ม|เอกสาร|สไลด์|ชีต|วิธีใช้/i,
};
/**
 * อ่าน "เนื้อหาจริงในไฟล์" ของวิชา — ใช้ตัดสินโหมดที่ขึ้นได้จริง
 *
 * ชื่อวิชาคนเดียวเชื่อถือไม่ได้: "การออกแบบระบบคอมพิวเตอร์และสถาปัตยกรรม"
 * ถูกจับเป็น tag=programming แต่เนื้อหาไม่มีเขียนโค้ดเลย (วิชา 1204102)
 * เลยนับ "หลักฐาน" จาก textContent ของไฟล์ที่ซิงก์มาจริงๆ
 */
type SubjectSignals = {
  code: number;    // ซินแท็กซ์/คำสั่งภาษาโปรแกรมจริง (ไม่นับแค่คำว่า "โปรแกรม")
  flow: number;    // ผังงาน / ขั้นตอน / ลำดับการทำงาน / ไดอะแกรม
  calc: number;    // โจทย์คำนวณ / สูตร / แปลงค่า / ลอจิก
  vocab: number;   // คำศัพท์ / ประโยค / แปลภาษา
  caseN: number;   // กรณีศึกษา / กฎหมาย / จริยธรรม
  howto: number;   // วิธีปฏิบัติ / ตั้งค่า / แบบฟอร์ม
  compare: number; // เปรียบเทียบ / ข้อดีข้อเสีย
};

const SIGNAL_PATTERNS: { k: keyof SubjectSignals; re: RegExp }[] = [
  { k: "code", re: /```|#include|\bint\s+main\b|\bprintf\s*\(|\bscanf\s*\(|\bcout\s*<<|\bcin\s*>>|\b(?:void|float|double|char|int)\s+\w+\s*\(|\bfor\s*\([^)]*\)\s*\{|\bwhile\s*\([^)]*\)\s*\{|\belse\s*\{|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\breturn\s+[\w.]+\s*;|\bimport\s+(?:os|sys|re|math|json|time|random|java|Scanner)\b|\bpublic\s+(?:static|class)\b|select\s+.+\s+from\s+\w+|insert\s+into\s+\w+|create\s+table\s+\w+|เขียนโปรแกรม|เขียนโค้ด|เขียนภาษาโปรแกรม|ภาษา\s*(?:C|C\+\+|Java|Python|JavaScript|C#)/i },
  { k: "flow", re: /ผังงาน|flow\s?chart|แผนผัง|แผนภาพ|ขั้นตอน|ลำดับขั้น|ลำดับการทำงาน|กระบวนการ|ผังโครงสร้าง|block\s*diagram|ไดอะแกรม|สถาปัตยกรรม|ลำดับชั้น/i },
  { k: "calc", re: /คำนวณ|สูตร|หาค่า|หาผล|แปลงเลข|เลขฐาน|ทศนิยม|เศษส่วน|ผลรวม|ค่าเฉลี่ย|สมการ|ลอจิก|truth\s*table|ตารางจริง|คาแนล|k-?map|ตรรกศาสตร์|พีชคณิต|แคลคูลัส|อนุกรม|เมทริกซ์|ฐานสอง|ฐานสิบ/i },
  { k: "vocab", re: /คำศัพท์|ความหมาย|แปลคำ|แปลประโยค|บทสนทนา|ออกเสียง|ไวยากรณ์|grammar|วลี|สำนวน|ประโยคตัวอย่าง/i },
  { k: "caseN", re: /กรณีศึกษา|กฎหมาย|จริยธรรม|ศีลธรรม|ผลกระทบ|สิทธิ|ข้อกฎหมาย|วินิจฉัย/ },
  { k: "howto", re: /วิธี(?:การ)?ใช้งาน|ขั้นตอนการทำ|การตั้งค่า|ติดตั้ง|แบบฟอร์ม|วิธีใช้|คู่มือการใช้งาน|สาธิตการ/ },
  { k: "compare", re: /เปรียบเทียบ|ข้อดี|ข้อเสีย|ความแตกต่าง|ความต่าง/ },
];

/** นับหลักฐานจาก title + textContent (คนละไฟล์ = นับทีละไฟล์ ไม่ต้องอ่านทั้งเล่ม) */
export function analyzeSubjectSignals(materials: { title?: string | null; textContent?: string | null }[]): SubjectSignals {
  const sig: SubjectSignals = { code: 0, flow: 0, calc: 0, vocab: 0, caseN: 0, howto: 0, compare: 0 };
  for (const m of (materials || []).slice(0, 30)) {
    const text = String(m.title || "") + " " + String(m.textContent || "").slice(0, 6000);
    if (!text.trim()) continue;
    for (const p of SIGNAL_PATTERNS) {
      const g = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
      sig[p.k] += (text.match(g) || []).length;
    }
  }
  return sig;
}

/**
 * โจทย์ต้นทางเป็น "โค้ดจริง" หรือไม่ (มีซินแท็กซ์ภาษาโปรแกรมจริง เช่น scanf/printf/for{}
 * แบบในสไลด์อาจารย์) — ถ้าใช่ต้องบังคับแนว "โค้ด" เสมอ แม้ผู้ใช้จะเลือกแนวอื่นไว้
 * (เช่น กด "รหัสเทียม" แล้วโจทย์จริงเป็นโค้ด C ล้วน -> ระบบสลับเป็นแนวโค้ดให้)
 *
 * hasCode = ต้องมีหลักฐานโค้ดใน "ไฟล์ของวิชา" ด้วย (analyzeSubjectSignals >= EXTRA_MIN.code)
 * กันวิชาสายภาษา/ทั่วไปที่บังเอิญมีคำว่า "โปรแกรม" ในประโยคถูกยกฟอร์แมตโค้ดมาให้
 */
function isRealCodeProblem(rawText: string, hasCode: boolean): boolean {
  if (!hasCode) return false;
  const p = SIGNAL_PATTERNS.find((x) => x.k === "code");
  if (!p) return false;
  // clone แบบไม่มี flag g กันค่า lastIndex ค้างข้ามรอบ (test() จะไม่สลับ true/false เอง)
  return new RegExp(p.re.source, p.re.flags.replace("g", "")).test(String(rawText || ""));
}

/**
 * รายการโหมดแบบกลาง — ใช้เติมเมื่อ "เนื้อหาไฟล์" บอกว่าวิชานี้มีจริง
 * แต่ชุดโหมดของสาขาวิชานั้นไม่มี (เช่น วิชาสถาปัตยกรรมที่โจทย์เป็นการคำนวณ)
 */
const GENERIC_CHOICES: Record<string, { key: string; icon: string; label: string; prompt: string; sub: string }> = {
  code: { key: "code", icon: "code-slash", label: "โค้ด", prompt: "เขียนโค้ดที่ถูกต้องและใช้งานได้จริงจากเนื้อหาในวิชานี้ พร้อมอธิบายการทำงานทีละบรรทัด", sub: "เขียนเอง ตรวจได้" },
  diagram: { key: "diagram", icon: "git-branch", label: "ดูผังภาพ / ขั้นตอน", prompt: "วาด flowchart ขั้นตอนสำคัญในวิชานี้ทีละหัวข้อ", sub: "ดูง่ายกว่าอ่านตัวหนังสือ" },
  steps: { key: "steps", icon: "list", label: "ทำโจทย์ทีละขั้น", prompt: "เลือกโจทย์จากเนื้อหาในวิชานี้มา 1 ข้อ แล้วแสดงวิธีคิดเป็นขั้นตอนพร้อมเหตุผล", sub: "ดูวิธีคิด ไม่ใช่แค่คำตอบ" },
  vocab: { key: "vocab", icon: "book", label: "คำศัพท์ / แปลคำ", prompt: "สรุปคำศัพท์สำคัญในวิชานี้ พร้อมความหมาย พาร์ทของคำ และประโยคตัวอย่าง", sub: "ท่องได้เลย" },
  grammar: { key: "grammar", icon: "text", label: "ไวยากรณ์ / โครงสร้างประโยค", prompt: "อธิบายโครงสร้างไวยากรณ์ที่ใช้ในวิชานี้ พร้อมตารางเปรียบเทียบกฎและตัวอย่างที่ถูกต้อง", sub: "เห็นภาพชัดขึ้น" },
  case: { key: "case", icon: "briefcase", label: "วิเคราะห์กรณีศึกษา", prompt: "เลือกประเด็นในเนื้อหาวิชานี้มา 1 เรื่อง แล้ววิเคราะห์เป็นกรณีศึกษาพร้อมเหตุผลและข้อสรุป", sub: "คิดเป็นระบบ" },
  compare: { key: "compare", icon: "swap-horizontal", label: "เปรียบเทียบแนวคิด", prompt: "เปรียบเทียบแนวคิดสำคัญในวิชานี้เป็นตาราง พร้อมข้อดีข้อเสียและตัวอย่างประกอบ", sub: "เห็นความต่างชัด" },
};

/** หลักฐานขั้นต่ำสำหรับโหมดที่ "ไม่อยู่ในชุดของสาขาวิชา" — ต้องชัดกว่าปกติ ไม่งั้นเมนูบวม */
const EXTRA_MIN: Record<string, number> = { code: 10, diagram: 15, steps: 20, vocab: 8, grammar: 8, case: 50, compare: 10 };

/** ชื่อ signal ใน SubjectSignals ที่ตรงกับ key ของโหมด (steps ไม่ใช่ชื่อ signal — จริงๆ คือ calc) */
const MODE_SIGNAL: Record<string, keyof SubjectSignals> = {
  code: "code", diagram: "flow", steps: "calc", vocab: "vocab", grammar: "vocab",
  case: "caseN", compare: "compare", howto: "howto",
};

export function choicesForSubject(subjectName: string, topics: any[], sig: SubjectSignals) {
  const tag = detectSubjectTag(subjectName);
  // ดูจาก "ชื่อหัวข้อ" ที่สแกนได้เท่านั้น ไม่ใช้คำอธิบายอิสระ
  // เพราะคำอธิบายจะทำให้จับผิดง่าย (เช่น "สเปรดชีต" ไปตรงกับ diagram, "ระบบดิจิทัล" ไปตรงกับ diagram)
  const hay = topics.map((t: any) => String(t.label || t.title || "")).join(" | ");

  const pool = [...(SUBJECT_CHOICES[tag] || GENERAL_CHOICES)];
  const inPool = new Set(pool.map((c) => c.key));
  // วิชาเครื่องมือ (Office / ทักษะดิจิทัล) = สอนทำตามขั้นตอนเสมอ ไม่ต้องรอหัวข้อมาเป็นตัวกำหนด
  const alwaysHowto = tag === "office" || tag === "digital";
  // โหมดโค้ด = ต้องมี "หลักฐานจริงในไฟล์" (ซินแท็กซ์/คำสั่ง) มากพอ
  // หัวข้อที่ชื่อตรง "เขียนโปรแกรม/โค้ด" ใช้ยืนยันได้เฉพาะเมื่อไฟล์ก็มีหลักฐานค้างอยู่บ้าง
  // (กันหัวข้อมาตรฐานของวิชาสาย CS อย่างคณิต ที่ชื่อวิชามี "คอมพิวเตอร์" แล้วไปดันโหมดโค้ดขึ้นมา)
  const STRONG_CODE_RE = /เขียนโปรแกรม|เขียนโค้ด|เขียนภาษาโปรแกรม|ภาษาโปรแกรม|พัฒนาโปรแกรม|โค้ด/i;
  const strongCode = sig.code >= EXTRA_MIN.code || (sig.code >= 3 && STRONG_CODE_RE.test(hay));

  const want = (k: string): boolean => {
    if (k === "explain") return true; // "อธิบาย" ใช้ได้ทุกวิชา
    if (k === "code") return strongCode;
    if (k === "howto") return alwaysHowto || MODE_REQUIRES.howto.test(hay);
    const byTopic = !!MODE_REQUIRES[k]?.test(hay);
    const sigKey = MODE_SIGNAL[k];
    const n = sigKey ? sig[sigKey] || 0 : 0;
    // อยู่ในชุดของสาขาวิชา = คงของเดิมไว้ (หัวข้อรองรับ หรือเนื้อหาในไฟล์ยืนยัน) ไม่ให้หายจากการอัปเดตนี้
    // ไม่อยู่ในชุด = เพิ่มใหม่ต้องมีหลักฐานแรงพอ (EXTRA_MIN) ไม่งั้นเมนูยาว
    return inPool.has(k) ? byTopic || n >= 2 : n >= (EXTRA_MIN[k] ?? Number.MAX_SAFE_INTEGER);
  };

  const out = pool.filter((c) => want(c.key));
  for (const k of Object.keys(EXTRA_MIN)) if (!inPool.has(k) && want(k)) out.push(GENERIC_CHOICES[k]);
  if (want("howto")) out.push(HOWTO_CHOICE[0]);
  return out;
}

router.post("/open", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, userId: req.user.id },
      include: { materials: { orderBy: [{ externalUpdatedAt: "desc" }, { createdAt: "asc" }] } },
    });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    const all = subject.materials || [];
    if (!all.length) {
      return res.json({
        empty: true,
        greeting: "วิชานี้ยังไม่มีเนื้อหาจาก Google Classroom กรุณาซิงก์ก่อนครับ",
        topics: [], choices: [], suggestions: [],
        generatedByAi: false,
      });
    }

    const rows = all.slice(0, 30).map((m: any) => ({
      id: m.id,
      title: String(m.title || "").slice(0, 160),
      hasFile: !!m.filePath,
      kind: m.mimeType === "text/plain" ? "ข้อความ" : m.mimeType === "text/uri-list" ? "ลิงก์" : "ไฟล์",
      snippet: String(m.textContent || "").replace(/\s+/g, " ").slice(0, 180),
      date: m.externalUpdatedAt ? new Date(m.externalUpdatedAt).toLocaleDateString("th-TH") : "",
      url: m.externalUrl || null,
    }));

    let result: any = null;
    try {
      result = await llm(
        [
          {
            role: "system",
            content:
              'คุณคืออาจารย์ AI ต้องสรุปหัวข้อจากเอกสารที่มีจริงเท่านั้น ห้ามสร้างหัวข้อใหม่ ' +
              "ตอบเป็น JSON เท่านั้น รูปแบบ: " +
              '{"greeting":"คำทักทีสั้นๆ 1-2 ประโยค ถามว่าอยากให้ช่วยเรื่องไหน",' +
              '"topics":[{"title":"...","summary":"...","level":"พื้นฐาน|กลาง|สูง"}]}' +
              " สร้าง 3-6 หัวข้อ โดยแต่ละหัวข้อต้องมาจากเอกสารที่ให้มาจริง ห้ามแต่งเรื่องใหม่",
          },
          { role: "user", content: "วิชา: " + subject.name + "\nเอกสาร:\n" + rows.map((r: any) => `- ${r.title} (${r.kind})\n  ${r.snippet}`).join("\n") },
        ],
        { json: true, temperature: 0.5, deadline: Date.now() + 40000 }
      );
    } catch (error) {
      console.warn("สรุปหัวข้อไม่สำเร็จ ใช้รายการเอกสารแทน", String(error));
    }

    // หัวข้อต้องมาจาก "สิ่งที่สแกนเจอในวิชา" ไม่ใช่คำ AI แต่งขึ้นเอง
    // ไม่งั้นหัวข้อในหน้านี้จะไม่ตรงกับหัวข้อที่ใช้เลือกสอบ
    let topics: any[] = [];
    try {
      const syl = await buildSubjectTopics(req.user.id, String(subject.id), String(subject.name));
      topics = (syl.topics || []).map((t: any) => ({
        title: t.label,
        summary: t.why || t.hint || "",
        level: t.group || "ทั่วไป",
        materialId: null,
        url: null,
        kind: t.fromCatalog ? "หัวข้อมาตรฐาน" : "หัวข้อจากเนื้อหา",
      }));
    } catch { /* ใช้วิธีสำรองด้านล่าง */ }

    if (!topics.length && result && Array.isArray(result.topics) && result.topics.length) {
      topics = result.topics.slice(0, 6).map((t: any) => {
        const key = String(t.title || "").toLowerCase();
        const matched = rows.find((r: any) => r.title.toLowerCase().includes(key.slice(0, 8)) || key.includes(r.title.toLowerCase().slice(0, 8)));
        return {
          title: String(t.title).slice(0, 160),
          summary: String(t.summary || "").slice(0, 220),
          level: String(t.level || "กลาง"),
          materialId: matched?.id || null,
          url: matched?.url || null,
          kind: matched?.kind || "ไฟล์",
        };
      });
    }
    if (!topics.length) {
      topics = rows.slice(0, 5).map((r: any) => ({
        title: r.title, summary: r.snippet, level: "กลาง",
        materialId: r.id, url: null, kind: r.kind,
      }));
    }

    const greeting = typeof result?.greeting === "string" && result.greeting.trim()
      ? result.greeting.trim().slice(0, 400)
      : `ผมอ่านไฟล์ใน ${subject.name} มาแล้ว ${rows.length} รายการ วันนี้อยากให้ช่วยเรื่องไหนครับ?`;

    const sig = analyzeSubjectSignals(all);
    res.json({
      greeting,
      topics,
      choices: choicesForSubject(String(subject.name), topics, sig),
      totalMaterials: all.length,
      suggestions: topics.slice(0, 3).map((t: any) => `อธิบายหัวข้อ "${t.title}" ให้ละเอียด`),
      generatedByAi: !!(result && Array.isArray(result.topics)),
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* นักเรียนเลือก "เริ่มต้น" หรือ "ข้าม" แล้วสร้างแผนเรียนตามนั้น */
router.post("/study-plan", requireAuth(), async (req: any, res) => {
  try {
    const subjectId = String(req.body?.subjectId || "").trim();
    const choices = Array.isArray(req.body?.choices) ? req.body.choices : [];
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, userId: req.user.id } });
    if (!subject) return res.status(404).json({ error: "ไม่พบวิชา" });

    const start = choices.filter((c: any) => c.choice === "start");
    const skip = choices.filter((c: any) => c.choice === "skip");
    const weak = String(req.body?.weakTopic || "").trim();

    const lines: string[] = [];
    if (weak) lines.push("นักเรียนบอกว่าอ่อนด้าน: " + weak);
    if (start.length) lines.push("เลือกเริ่มตั้งแต่ต้น: " + start.map((c: any) => c.title).join(", "));
    if (skip.length) lines.push("เลือกข้าม: " + skip.map((c: any) => c.title).join(", "));
    const decision = lines.join("\n") || "ยังไม่ได้เลือก";

    let result: any = null;
    try {
      result = await llm(
        [
          {
            role: "system",
            content:
              'วางแผนการเรียนจากหัวข้อที่มีจริง ตอบเป็น JSON เท่านั้น รูปแบบ: ' +
              '{"recommendation":"คำแนะนำสั้นๆ","steps":[{"title":"...","detail":"...","minutes":20}]} ' +
              "เรียงลำดับหัวข้อที่เลือกเริ่มต้นก่อน ห้ามแต่งหัวข้อใหม่",
          },
          { role: "user", content: "วิชา: " + subject.name + "\nการตัดสินใจของนักเรียน:\n" + decision },
        ],
        { json: true, temperature: 0.5 }
      );
    } catch (error) {
      console.warn("สร้างแผนไม่สำเร็จ", String(error));
    }

    const fallbackSteps = start.map((c: any) => ({
      title: c.title,
      detail: weak && c.title.includes(weak) ? "เริ่มจากพื้นฐานตรงนี้ เพราะคุณบอกว่าอ่อนที่สุด" : "ทบทวนแล้วลงมือทำ",
      minutes: 25,
    }));

    res.json({
      recommendation: result?.recommendation
        ? String(result.recommendation).slice(0, 800)
        : skip.length
          ? `เริ่มจาก "${start[0]?.title || "หัวข้อแรก"}" แล้วไปต่อทีละหัวข้อ ข้าม ${skip.length} หัวข้อไป`
          : "เริ่มจากหัวข้อแรกแล้วไล่ไปทีละหัวข้อ",
      steps: Array.isArray(result?.steps) && result.steps.length ? result.steps.slice(0, 8) : fallbackSteps,
      skipped: skip.map((c: any) => c.title),
      generatedByAi: !!(result && Array.isArray(result.steps)),
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* ------------------------------------------------------------------ */
/* เสียงพูด — Gemini TTS ต้องใช้ endpoint แบบ native (OpenAI-compat ไม่รับ) */
/* ------------------------------------------------------------------ */

const TTS_DIR = path.resolve(process.env.TTS_DIR || path.join(process.cwd(), "storage", "tts"));
const TTS_MODEL = process.env.TTS_MODEL || "gemini-3.8-flash-tts";
const TTS_VOICES = ["Kore", "Aoede", "Puck", "Charon", "Fenrir"];

router.post("/tts", requireAuth(), async (req: any, res) => {
  try {
    const text = String(req.body?.text || "").trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: "ไม่มีข้อความให้อ่าน" });
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า AI_API_KEY" });

    const hash = crypto.createHash("sha1").update(TTS_MODEL + "|" + (process.env.TTS_VOICE || "Kore") + "|" + text).digest("hex").slice(0, 20);
    const file = path.join(TTS_DIR, hash + ".wav");
    if (fs.existsSync(file)) return res.json({ url: `/studypath/tutor/tts/${hash}.wav`, cached: true });

    fs.mkdirSync(TTS_DIR, { recursive: true });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`;
    let lastError = "";
    for (const voice of [process.env.TTS_VOICE || "Kore", ...TTS_VOICES]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ` + (await response.text().catch(() => "")).slice(0, 160);
        continue;
      }
      const body: any = await response.json();
      const inline = body?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
      if (!inline) { lastError = "ไม่ได้รับข้อมูลเสียงกลับมา"; continue; }
      fs.writeFileSync(file, Buffer.from(inline.inlineData.data, "base64"));
      return res.json({ url: `/studypath/tutor/tts/${hash}.wav`, voice });
    }
    res.status(502).json({ error: "สร้างเสียงไม่สำเร็จ: " + lastError });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

/* เสิร์ฟไฟล์เสียงที่สร้างไว้ */
router.get("/tts/:file", (req: any, res) => {
  const safe = path.basename(String(req.params.file || ""));
  const file = path.join(TTS_DIR, safe);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "ไม่พบไฟล์เสียง" });
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Cache-Control", "public, max-age=604800");
  fs.createReadStream(file).pipe(res);
});

export default router;
