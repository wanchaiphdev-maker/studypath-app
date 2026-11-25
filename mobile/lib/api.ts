import { Platform } from "react-native";
import { getToken, removeToken, setToken } from "./storage";

/**
 * ฐาน URL ของ API
 * - แอปมือถือ/เดฟ: ใช้ EXPO_PUBLIC_API_URL ตามเดิม
 * - เว็บที่แชร์ลิงก์: ใช้โดเมนที่ผู้ใช้เปิดอยู่จริง (window.location.origin)
 *   เพราะลิงก์ tunnel เปลี่ยนทุกครั้งที่รีสตาร์ท ถ้าฝัง URL เก่าไว้ใน build แอปจะพังทั้งแอป
 *   (อาการ: เปิดบน iPhone/เครื่องอื่นแล้ว error เพราะยิงไปโดเมนที่ตายแล้ว)
 */
function resolveBase(): string | undefined {
  const env = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    // dev server (metro) — API อยู่คนละพอร์ต ต้องใช้ค่าจาก .env
    if (/:(8081|19000|19006)$/.test(origin)) return env;
    if (!env) return origin;
    try {
      const url = new URL(env);
      const envHost = url.host;
      const envName = url.hostname;
      const pageIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
      const envIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(envName);
      // build ที่ฝัง localhost ไว้ (ค่าจาก .env ตอน export) แต่เปิดผ่านโดเมนจริง
      // → ต้องยิงไปโดเมนที่ผู้ใช้เปิดอยู่ ไม่งั้น iPhone/เครื่องอื่นจะเจอ "เชื่อมต่อไม่สำเร็จ"
      if (envIsLocal && !pageIsLocal) return origin;
      // build ที่ฝังโดเมน tunnel เก่าไว้ → ใช้โดเมนปัจจุบันแทนอัตโนมัติ
      if (/\.trycloudflare\.com$/i.test(envHost) && envHost !== window.location.host) return origin;
    } catch {
      return origin;
    }
  }
  return env;
}

export const BASE = resolveBase();
export const BASE_URL = BASE?.replace(/\/$/, "");

function getUrl(path: string) {
  if (!BASE) throw new Error("ตั้งค่า EXPO_PUBLIC_API_URL ในไฟล์ .env ก่อน");
  return `${BASE.replace(/\/$/, "")}${path}`;
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const method = (opts.method || "GET").toUpperCase();
  const call = () =>
    fetch(getUrl(path), {
      ...opts,
      // กันเบราว์เซอร์ตอบ 304 จากแคช (fetch จะมองว่าไม่ ok แล้วข้อมูลหายทั้งหน้า)
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });

  let response: Response;
  let retried = false;
  try {
    response = await call();
  } catch (error) {
    // เน็ตมือถือสะดุดบ่อย — คำขอที่เรียกซ้ำได้ ลองอีกครั้งก่อนแจ้งผู้ใช้
    if (method === "GET" || method === "HEAD") {
      await new Promise((r) => setTimeout(r, 600));
      try {
        response = await call();
        retried = true;
      } catch {
        throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
      }
    } else {
      throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
    }
  }

  // tunnel/พร็อกซีตอบ 502-504 เป็นหน้า HTML ชั่วคราว — ลองใหม่ก่อนสรุปว่าเซิร์ฟเวอร์พัง
  if (!retried && (method === "GET" || method === "HEAD") && [502, 503, 504].includes(response.status)) {
    await new Promise((r) => setTimeout(r, 900));
    try {
      response = await call();
    } catch {
      /* ใช้ผลเดิมด้านล่าง */
    }
  }

  if (!response.ok) {
    // token หมดอายุ/ใช้ไม่ได้ — ล้างทิ้งให้หน้าจอรู้ว่าต้องล็อกอินใหม่ ไม่ใช่เงียบ ๆ แล้วค้าง
    // แต่ถ้าคำขอนี้ไม่ได้แนบ token ไป (เช่น เพิ่งเปิดแอปแล้วยังอ่าน token ไม่ทัน) อย่าเพิ่งลบทิ้ง
    // ไม่งั้นผู้ใช้จะถูกล็อกเอาต์ทั้งที่ token ยังดีอยู่
    if ((response.status === 401 || response.status === 403) && token) {
      await removeToken().catch(() => undefined);
    }
    const body = await response.json().catch(() => ({}));
    // ข้อความแนะนำจากเซิร์ฟเวอร์ (hint) ต้องส่งถึงหน้าจอด้วย ไม่งั้นผู้ใช้เห็นแค่ "ดึงไม่ได้" แล้วไปต่อไม่ถูก
    const err = new Error(body.error || response.statusText) as Error & { hint?: string };
    if (body && typeof body.hint === "string" && body.hint.trim()) err.hint = body.hint.trim();
    throw err;
  }
  return response.json();
}

/** ตัวช่วยเช็คว่า token ยังใช้ได้อยู่ไหม */
export async function isLoggedIn(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const response = await fetch(getUrl("/studypath/progress"), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function login(email: string, password: string) {
  const response = await fetch(getUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  await setToken(body.token);
  return body.user;
}

export async function register(name: string, email: string, password: string) {
  const response = await fetch(getUrl("/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  await setToken(body.token);
  return body.user;
}
export async function getCurriculum() { return api<any[]>("/studypath/curriculum"); }
export async function createYear(name: string) { return api("/studypath/curriculum/years", { method: "POST", body: JSON.stringify({ name }) }); }
export async function createSemester(academicYearId: string, name: string) { return api("/studypath/curriculum/semesters", { method: "POST", body: JSON.stringify({ academicYearId, name }) }); }
export async function getSubjects() { return api<any[]>("/studypath/subjects"); }
export async function createSubject(semesterId: string, name: string, code = "") { return api("/studypath/subjects", { method: "POST", body: JSON.stringify({ semesterId, name, code }) }); }
export async function getSubject(id: string) { return api<any>("/studypath/subjects/" + id); }
export async function createMaterial(subjectId: string, title: string, textContent: string) { return api("/studypath/materials", { method: "POST", body: JSON.stringify({ subjectId, title, textContent }) }); }

export async function uploadMaterial(subjectId: string, file: { uri: string; name: string; mimeType?: string }, title?: string) {
  const token = await getToken();
  if (!BASE) throw new Error("ตั้งค่า EXPO_PUBLIC_API_URL ในไฟล์ .env ก่อน");
  const form = new FormData();
  form.append("subjectId", subjectId);
  if (title?.trim()) form.append("title", title.trim());
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/pdf",
  } as any);
  const response = await fetch(getUrl("/studypath/materials/upload"), {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}
export async function askMaterial(materialId: string, question: string) { return api("/studypath/materials/" + materialId + "/ask", { method: "POST", body: JSON.stringify({ question }) }); }
export async function getProgress() { return api<any>("/studypath/progress"); }
export async function logStudySession(minutes: number, subjectId?: string, goal?: string) { return api("/studypath/study-sessions", { method: "POST", body: JSON.stringify({ minutes, subjectId, goal }) }); }
export async function getReviewCards() { return api<any[]>("/studypath/review"); }
export async function generateReviewCards(subjectId?: string) { return api("/studypath/review/generate", { method: "POST", body: JSON.stringify({ subjectId }) }); }
export async function reviewCard(cardId: string, rating: number) { return api("/studypath/review/" + cardId + "/review", { method: "POST", body: JSON.stringify({ rating }) }); }
export async function getPlanner() { return api<any[]>("/studypath/planner"); }
export async function createPlannerTask(input: any) { return api("/studypath/planner", { method: "POST", body: JSON.stringify(input) }); }
export async function completePlannerTask(id: string, completed: boolean) { return api("/studypath/planner/" + id, { method: "PATCH", body: JSON.stringify({ completed }) }); }
export async function getKnowledge(subjectId: string) { return api<any>("/studypath/knowledge/" + subjectId); }
export async function getCommunity() { return api<any[]>("/studypath/community"); }
export async function createCommunityPost(title: string, content: string, subjectId?: string) { return api("/studypath/community", { method: "POST", body: JSON.stringify({ title, content, subjectId }) }); }
export async function getCommunityPost(id: string) { return api<any>("/studypath/community/" + id); }
export async function commentCommunity(id: string, content: string) { return api("/studypath/community/" + id + "/comments", { method: "POST", body: JSON.stringify({ content }) }); }
export async function getPortalOverview() { return api<any>("/studypath/portal/overview"); }
export async function getGoogleAuthUrl(returnUrl: string) { return api<{url:string}>("/auth/google/url", { method: "POST", body: JSON.stringify({ returnUrl }) }); }
export async function getClassroomStatus() { return api<any>("/studypath/classroom/status"); }
export async function getClassroomCourses() { return api<any[]>("/studypath/classroom/courses"); }
export async function syncClassroom(mappings: { courseId: string; subjectId: string }[]) { return api<any>("/studypath/classroom/sync", { method: "POST", body: JSON.stringify({ mappings }) }); }

// --- AI Tutor: สอนแบบอิงเนื้อหาจริงในวิชา ---
export async function tutorTts(text: string) {
  return api<any>("/studypath/tutor/tts", { method: "POST", body: JSON.stringify({ text }) });
}

/** ถาม–ตอบแบบสตรีม: ข้อความทยอยกลับมา ผู้ใช้เห็นผลทันที
 *  - ถ้าเซิร์ฟเวอร์สั่ง reset (เปลี่ยนโมเดลกลางทาง) จะล้างข้อความที่พิมพ์ค้างไว้ ไม่ให้ต่อกันมั่ว
 *  - ถ้าเงียบเกิน 60 วิ หรือ stream จบโดยไม่มี done = แจ้งผู้ใช้ว่าการเชื่อมต่อขาดกลางทาง
 */
export async function tutorAskStream(
  subjectId: string, question: string, difficulty: string, mode: string, speed: string,
  handlers: {
    onSources?: (s: any[]) => void;
    onDelta?: (t: string) => void;
    onDone?: (d: any) => void;
    onError?: (e: string) => void;
    onReset?: () => void;
  },
  history: { role: "user" | "assistant"; content: string }[] = []
) {
  const token = await getToken();
  const controller = new AbortController();
  let lastByte = Date.now();
  let completed = false;
  const watchdog = setInterval(() => {
    if (!completed && Date.now() - lastByte > 60000) controller.abort();
  }, 5000);

  /** อ่าน SSE ทั้งก้อนเป็นข้อความแล้วแปลง event เอง
   *  ใช้เมื่อเบราว์เซอร์อ่านสตรีมไม่ได้ (iOS Safari < 16.4: response.body เป็น null)
   *  ผู้ใช้จะไม่ได้เห็นข้อความทยอยขึ้น แต่ได้คำตอบครบเหมือนกัน แทนที่จะเจอ error */
  const consumeAsText = async (raw: string) => {
    let any = false;
    for (const block of raw.split("\n\n")) {
      const ev = block.match(/event:\s*(\S+)/)?.[1];
      const line = block.match(/data:\s*(.+)/)?.[1];
      if (!ev || !line) continue;
      let payload: any = {};
      try { payload = JSON.parse(line); } catch { continue; }
      if (ev === "sources") handlers.onSources?.(payload.sources || []);
      else if (ev === "delta") { any = true; handlers.onDelta?.(payload.text || ""); }
      else if (ev === "reset") handlers.onReset?.();
      else if (ev === "done") { completed = true; handlers.onDone?.(payload); }
      else if (ev === "error") { completed = true; handlers.onError?.(payload.error || "ผิดพลาด"); }
    }
    if (!any && !completed) { completed = true; handlers.onError?.("ไม่ได้รับคำตอบจากเซิร์ฟเวอร์"); }
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const payload = () => JSON.stringify({ subjectId, question, difficulty, mode, speed, history: history.slice(-10) });

  /** แผนสำรอง: ถ้าสตรีมขาดกลางทาง (เน็ตมือถือ/iOS ตัดการเชื่อมต่อ) ให้ยิงคำขอปกติที่รอผลเต็ม
   *  ผู้ใช้จะไม่ได้เห็นข้อความทยอย แต่ได้คำตอบครบแทนที่จะเจอ error แล้วต้องพิมพ์ใหม่เอง */
  const retryFull = async (wasPartial: boolean) => {
    try {
      const fallback = new AbortController();
      const timer = setTimeout(() => fallback.abort(), 90000);
      const response = await fetch(getUrl("/studypath/tutor/ask"), {
        method: "POST",
        headers,
        body: payload(),
        signal: fallback.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return false;
      const data: any = await response.json().catch(() => null);
      const answer = String(data?.answer || "");
      if (!answer) return false;
      if (wasPartial) handlers.onReset?.();
      if (Array.isArray(data?.sources)) handlers.onSources?.(data.sources);
      completed = true;
      handlers.onDelta?.(answer);
      handlers.onDone?.({ usedModel: data?.usedModel, grounded: data?.grounded, casual: data?.casual, fallback: true });
      return true;
    } catch {
      return false;
    }
  };

  try {
    const res = await fetch(getUrl("/studypath/tutor/ask/stream"), {
      method: "POST",
      headers,
      body: payload(),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 5xx = เซิร์ฟเวอร์สะดุดชั่วคราว → ลองแบบไม่สตรีมก่อนแจ้งผู้ใช้
      if (res.status >= 500) { completed = true; if (await retryFull(false)) return; handlers.onError?.("เชื่อมต่อ AI ไม่สำเร็จ (" + res.status + ")"); return; }
      completed = true;
      handlers.onError?.("เชื่อมต่อ AI ไม่สำเร็จ (" + res.status + ")");
      return;
    }

    const body: any = (res as any).body;
    if (!body || typeof body.getReader !== "function") {
      // เบราว์เซอร์ไม่รองรับสตรีม → อ่านทีเดียวทั้งก้อน
      await consumeAsText(await res.text());
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByte = Date.now();
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() || "";
      for (const block of blocks) {
        const ev = block.match(/event:\s*(\S+)/)?.[1];
        const raw = block.match(/data:\s*(.+)/)?.[1];
        if (!ev || !raw) continue;
        let payload: any = {};
        try { payload = JSON.parse(raw); } catch { continue; }
        if (ev === "sources") handlers.onSources?.(payload.sources || []);
        else if (ev === "delta") handlers.onDelta?.(payload.text || "");
        else if (ev === "reset") handlers.onReset?.();
        else if (ev === "done") { completed = true; handlers.onDone?.(payload); }
        else if (ev === "error") { completed = true; handlers.onError?.(payload.error || "ผิดพลาด"); }
      }
    }
    if (!completed) {
      // สตรีมจบแบบไม่มี done = ถูกตัดกลางทาง ลองแบบไม่สตรีมแทนการปล่อยให้ผู้ใช้เห็น error
      completed = true;
      if (await retryFull(true)) return;
      handlers.onError?.("การเชื่อมต่อขาดกลางทาง กรุณาลองอีกครั้ง");
    }
  } catch (error: any) {
    if (!completed) {
      completed = true;
      // ถูกตัดกลางทาง/เน็ตหลุด → ยังมีโอกาสได้คำตอบครบด้วยคำขอปกติ
      if (error?.name === "AbortError" || /failed to fetch|network request failed|load failed/i.test(String(error?.message || error))) {
        if (await retryFull(true)) return;
      }
      const raw = String(error?.message || error);
      const isNetwork = /failed to fetch|network request failed|load failed/i.test(raw);
      handlers.onError?.(
        error?.name === "AbortError"
          ? "การเชื่อมต่อขาดหาย (ไม่มีการตอบกลับเกิน 60 วินาที)"
          : isNetwork
            ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
            : raw
      );
    }
  } finally {
    clearInterval(watchdog);
  }
}
export async function tutorOpen(subjectId: string, difficulty: string) {
  return api<any>("/studypath/tutor/open", { method: "POST", body: JSON.stringify({ subjectId, difficulty }) });
}
export async function tutorAsk(subjectId: string, question: string, difficulty: string, mode?: string) {
  return api<any>("/studypath/tutor/ask", { method: "POST", body: JSON.stringify({ subjectId, question, difficulty, mode }) });
}
export async function tutorPlan(subjectId: string) {
  return api<any>("/studypath/tutor/plan", { method: "POST", body: JSON.stringify({ subjectId }) });
}
/** นักเรียนเลือกจุดอ่อน + เลือกว่าหัวข้อไหน "เริ่มต้น"/"ข้าม" แล้วให้ AI วางแผนตามนั้น */
export async function tutorStudyPlan(subjectId: string, choices: { title: string; choice: "start" | "skip" }[], weakTopic: string) {
  return api<any>("/studypath/tutor/study-plan", { method: "POST", body: JSON.stringify({ subjectId, choices, weakTopic }) });
}
export async function tutorDiagnose(subjectId: string, difficulty: string, topics?: string[]) {
  return api<any>("/studypath/tutor/diagnose", { method: "POST", body: JSON.stringify({ subjectId, difficulty, topics: topics || [] }) });
}
export async function tutorEvaluate(subjectId: string, questions: any[], answers: number[], quizId?: string) {
  return api<any>("/studypath/tutor/diagnose/evaluate", { method: "POST", body: JSON.stringify({ subjectId, questions, answers, quizId }) });
}

/** ดึงโจทย์จริงจากในวิชา พร้อมจัดรูปแบบตามที่เลือก (topics = หัวข้อที่ผู้ใช้เลือกตอนกดดึง)
 *  pick.materialId = ดึงจากไฟล์นั้นไฟล์เดียว, pick.level = กรองระดับความยาก (ไม่เลือก = เรียงง่ายก่อน) */
export async function tutorProblem(subjectId: string, format: string, seen: string[] = [], src?: string, topics?: string[], pick?: { materialId?: string; level?: string }) {
  return api<any>("/studypath/tutor/diagnose/problem", {
    method: "POST",
    body: JSON.stringify({
      subjectId, format, seen, source: src || "", topics: topics || [],
      materialId: pick?.materialId || "", level: pick?.level || "",
    }),
  });
}

/** รายชื่อไฟล์ในวิชา + จำนวนโจทย์ที่ดึงได้ + ระดับยากง่าย (เรียงตามลำดับใน Classroom) */
export async function tutorFiles(subjectId: string) {
  return api<any>("/studypath/tutor/diagnose/files?subjectId=" + encodeURIComponent(subjectId), { method: "GET" });
}

/** โจทย์ซ้อน: สร้างโจทย์ใหม่จากไฟล์เดียวกัน ให้ลองทำเอง ไม่มีเฉลย */
export async function tutorProblemVariant(subjectId: string, format: string, baseMaterialId: string, level = "") {
  return api<any>("/studypath/tutor/diagnose/problem", {
    method: "POST",
    body: JSON.stringify({ subjectId, format, variant: true, baseMaterialId, level }),
  });
}

/** ส่งคำตอบโจทย์ไปให้อาจารย์ตรวจ (format = แนวคำตอบที่ใช้ตอบ เช่น "pseudocode") */
export async function tutorCheckAnswer(subjectId: string, problem: string, answer: string, deliverables: string[] = [], done: string[] = [], format?: string) {
  return api<any>("/studypath/tutor/diagnose/answer", { method: "POST", body: JSON.stringify({ subjectId, problem, answer, deliverables, done, format: format || "" }) });
}

/** ขอคำใบ้โหมดฝึกทำรหัสเทียม — ใบ้ทีละขั้น ไม่บอกเฉลย (prev = คำใบ้ที่ได้ไปแล้ว กันซ้ำ/ให้ลึกขึ้น) */
export async function tutorPracticeHint(subjectId: string, problem: string, answer: string, prev: string[] = []) {
  return api<any>("/studypath/tutor/diagnose/hint", { method: "POST", body: JSON.stringify({ subjectId, problem, answer, prev }) });
}
/** ร่างเฉลยโค้ดจากโจทย์ปัจจุบันโดยตรง (ไม่ผ่านบริบทแชตทั่วไป) */
export async function tutorCodeSolution(subjectId: string, problem: string, answer = "", materialId = "") {
  return api<any>("/studypath/tutor/diagnose/code-solution", { method: "POST", body: JSON.stringify({ subjectId, problem, answer, materialId }) });
}

/** วิเคราะห์โจทย์ (Input/Output/Process/ตัวแปร/ค่าเริ่มต้น/รหัสเทียม) — ผู้เรียนกดดูเอง แยกจากตัวโจทย์ */
export async function tutorAnalyze(subjectId: string, problem: string) {
  return api<any>("/studypath/tutor/diagnose/analyze", { method: "POST", body: JSON.stringify({ subjectId, problem }) });
}
/** หัวข้อสอบของวิชา — สแกนจากเอกสาร + งานที่ส่ง แล้วให้ AI คัดเหลือเฉพาะที่เกี่ยว */
export async function tutorTopics(subjectId: string, refresh = false) {
  return api<any>("/studypath/tutor/topics?subjectId=" + encodeURIComponent(subjectId) + (refresh ? "&refresh=1" : ""), { method: "GET" });
}
