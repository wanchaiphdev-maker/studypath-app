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