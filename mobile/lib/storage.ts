import * as SecureStore from "expo-secure-store";
const isWeb = typeof document !== "undefined";
const WEB_KEY = "studypath_token";
export async function getToken() { return isWeb ? window.localStorage.getItem(WEB_KEY) : SecureStore.getItemAsync("token"); }
export async function setToken(token: string) { if (isWeb) window.localStorage.setItem(WEB_KEY, token); else await SecureStore.setItemAsync("token", token); }
export async function removeToken() { if (isWeb) window.localStorage.removeItem(WEB_KEY); else await SecureStore.deleteItemAsync("token"); }
