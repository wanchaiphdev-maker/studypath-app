import { useEffect, useRef } from "react";
import { Alert, AlertHost } from "../lib/alert";
import * as Linking from "expo-linking";
import { setToken } from "../lib/storage";
import { Stack, router, useRootNavigationState } from "expo-router";
import { ThemeProvider } from "../lib/theme";
import { parseAuthCallback } from "../lib/googleAuth";

function useGoogleCallback() {
  const navigationState = useRootNavigationState();
  const handledUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!navigationState?.key) return;
    let active = true;
    const handle = async (url: string | null) => {
      const cb = parseAuthCallback(url);
      if (!cb || handledUrl.current === url || !active) return;
      if (cb.error) { Alert.alert("เข้าสู่ระบบด้วย Google ไม่สำเร็จ", cb.error); return; }
      handledUrl.current = url;
      await setToken(cb.token!);
      if (!active) return;
      // On web, OAuth returns to the same route with ?token=...; reload only after
      // persisting the token so protected status requests run with the new session.
      if (typeof window !== "undefined") {
        const callbackUrl = new URL(url || window.location.href);
        const cleanPath = callbackUrl.pathname + callbackUrl.hash;
        window.location.replace(cleanPath || "/login");
        return;
      }
      router.replace("/(tabs)");
    };
    // Expo Router web OAuth returns to the current browser URL; Linking.getInitialURL()
    // may be null on web, so inspect window.location.href directly.
    if (typeof window !== "undefined") {
      void handle(window.location.href);
    } else {
      Linking.getInitialURL().then(handle).catch(() => undefined);
    }
    const sub = Linking.addEventListener("url", ({ url }) => void handle(url));
    return () => { active = false; sub.remove(); };
  }, [navigationState?.key]);
}
export default function RootLayout() {
  useGoogleCallback();
  return <ThemeProvider><AlertHost /><Stack initialRouteName="(auth)/login" screenOptions={{ headerShown: false }}>
    <Stack.Screen name="(auth)/login" /><Stack.Screen name="(auth)/register" />
    <Stack.Screen name="(tabs)" /><Stack.Screen name="community" /><Stack.Screen name="community/[id]" />
    <Stack.Screen name="subject/[id]" />
  </Stack></ThemeProvider>;
}
