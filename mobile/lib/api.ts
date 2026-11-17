import { getToken, removeToken, setToken } from "./storage";

export const BASE = process.env.EXPO_PUBLIC_API_URL;
export const BASE_URL = BASE?.replace(/\/$/, "");

function getUrl(path: string) {
  if (!BASE) throw new Error("ตั้งค่า EXPO_PUBLIC_API_URL ในไฟล์ .env ก่อน");
  return `${BASE.replace(/\/$/, "")}${path}`;
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const response = await fetch(getUrl(path), {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!response.ok) {
    // token หมดอายุ/ใช้ไม่ได้ — ล้างทิ้งให้หน้าจอรู้ว่าต้องล็อกอินใหม่ ไม่ใช่เงียบ ๆ แล้วค้าง
    if (response.status === 401 || response.status === 403) {
      await removeToken().catch(() => undefined);
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

/** ตัวช่วยเช็คว่า token ยังใช้ได้อยู่ไหม */
export async function isLoggedIn(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const response = await fetch(getUrl("/studypath/progress"), {
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

/** ถาม–ตอบแบบสตรีม: ข้อความทยอยกลับมา ผู้ใช้เห็นผลทันที */
export async function tutorAskStream(
  subjectId: string, question: string, difficulty: string, mode: string, speed: string,
  handlers: { onSources?: (s: any[]) => void; onDelta?: (t: string) => void; onDone?: (d: any) => void; onError?: (e: string) => void }
) {
  const token = await getToken();
  const res = await fetch(getUrl("/studypath/tutor/ask/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ subjectId, question, difficulty, mode, speed }),
  });
  if (!res.ok || !res.body) { handlers.onError?.("เชื่อมต่อ AI ไม่สำเร็จ"); return; }

  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
      else if (ev === "done") handlers.onDone?.(payload);
      else if (ev === "error") handlers.onError?.(payload.error || "ผิดพลาด");
    }
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

/** ดึงโจทย์จริงจากในวิชา พร้อมจัดรูปแบบตามที่เลือก (topics = หัวข้อที่ผู้ใช้เลือกตอนกดดึง) */
export async function tutorProblem(subjectId: string, format: string, seen: string[] = [], src?: string, topics?: string[]) {
  return api<any>("/studypath/tutor/diagnose/problem", { method: "POST", body: JSON.stringify({ subjectId, format, seen, source: src || "", topics: topics || [] }) });
}

/** โจทย์ซ้อน: สร้างโจทย์ใหม่จากไฟล์เดียวกัน ให้ลองทำเอง ไม่มีเฉลย */
export async function tutorProblemVariant(subjectId: string, format: string, baseMaterialId: string) {
  return api<any>("/studypath/tutor/diagnose/problem", {
    method: "POST",
    body: JSON.stringify({ subjectId, format, variant: true, baseMaterialId }),
  });
}

/** ส่งคำตอบโจทย์ไปให้อาจารย์ตรวจ (format = แนวคำตอบที่ใช้ตอบ เช่น "pseudocode") */
export async function tutorCheckAnswer(subjectId: string, problem: string, answer: string, deliverables: string[] = [], done: string[] = [], format?: string) {
  return api<any>("/studypath/tutor/diagnose/answer", { method: "POST", body: JSON.stringify({ subjectId, problem, answer, deliverables, done, format: format || "" }) });
}

/** วิเคราะห์โจทย์ (Input/Output/Process/ตัวแปร/ค่าเริ่มต้น/รหัสเทียม) — ผู้เรียนกดดูเอง แยกจากตัวโจทย์ */
export async function tutorAnalyze(subjectId: string, problem: string) {
  return api<any>("/studypath/tutor/diagnose/analyze", { method: "POST", body: JSON.stringify({ subjectId, problem }) });
}
/** หัวข้อสอบของวิชา — สแกนจากเอกสาร + งานที่ส่ง แล้วให้ AI คัดเหลือเฉพาะที่เกี่ยว */
export async function tutorTopics(subjectId: string, refresh = false) {
  return api<any>("/studypath/tutor/topics?subjectId=" + encodeURIComponent(subjectId) + (refresh ? "&refresh=1" : ""), { method: "GET" });
}
