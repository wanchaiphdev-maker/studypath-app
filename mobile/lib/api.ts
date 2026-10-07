import * as SecureStore from "expo-secure-store";

export const BASE = process.env.EXPO_PUBLIC_API_URL;
export const BASE_URL = BASE?.replace(/\/$/, "");

function getUrl(path: string) {
  if (!BASE) throw new Error("ตั้งค่า EXPO_PUBLIC_API_URL ในไฟล์ .env ก่อน");
  return `${BASE.replace(/\/$/, "")}${path}`;
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync("token");
  const response = await fetch(getUrl(path), {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

export async function login(email: string, password: string) {
  const response = await fetch(getUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  await SecureStore.setItemAsync("token", body.token);
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
  await SecureStore.setItemAsync("token", body.token);
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
  const token = await SecureStore.getItemAsync("token");
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
export async function generateQuiz(subjectId: string, count = 5) { return api<any>("/studypath/subjects/" + subjectId + "/quizzes/generate", { method: "POST", body: JSON.stringify({ count }) }); }
export async function submitQuiz(quizId: string, answers: any[]) { return api<any>("/studypath/quizzes/" + quizId + "/attempt", { method: "POST", body: JSON.stringify({ answers }) }); }
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
