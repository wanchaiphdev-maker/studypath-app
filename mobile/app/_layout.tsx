import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { Stack, router, useRootNavigationState } from "expo-router";
import { ThemeProvider } from "../lib/theme";
import { parseAuthCallback } from "../lib/googleAuth";

/** รับ token จาก deep link ที่ backend ของ Google callback ส่งกลับมา (ทั้งตอนเปิดแอปใหม่และตอนกลับจากเบราว์เซอร์) */
function useGoogleCallback() {
  const navigationState = useRootNavigationState();
  const handled = useRef(false);

  useEffect(() => {
    if (!navigationState?.key || handled.current) return;
    let active = true;

    const handle = async (url: string | null) => {
      const cb = parseAuthCallback(url);
      if (!cb || handled.current || !active) return;
      if (cb.error) {
        Alert.alert("เข้าสู่ระบบด้วย Google ไม่สำเร็จ", cb.error);
        return;
      }
      handled.current = true;
      await SecureStore.setItemAsync("token", cb.token!);
      if (active) router.replace("/(tabs)");
    };

    Linking.getInitialURL().then(handle).catch(() => undefined);
    const sub = Linking.addEventListener("url", ({ url }) => {
      void handle(url);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [navigationState?.key]);
}

export default function RootLayout() {
  useGoogleCallback();

  return (
    <ThemeProvider>
      <Stack initialRouteName="(auth)/login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/register" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="call/[room]" />
        <Stack.Screen name="contest/index" />
        <Stack.Screen name="contest/[id]" />
      </Stack>
    </ThemeProvider>
  );
}
