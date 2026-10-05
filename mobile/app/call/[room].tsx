import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { api } from "../../lib/api";

type CallModule = {
  CallRoom: ComponentType<{ serverUrl: string; token: string }>;
  prepareCall: () => Promise<void>;
  endCall: () => void;
};

export default function Call() {
  const { room } = useLocalSearchParams<{ room: string }>();
  const [credentials, setCredentials] = useState<{ token: string; url: string }>();
  const [error, setError] = useState("");
  const [callModule, setCallModule] = useState<CallModule>();

  useEffect(() => {
    let active = true;
    let loaded: CallModule | undefined;

    async function connect() {
      try {
        // โหลดโมดูลวิดีโอตอนเข้าหน้านี้เท่านั้น — ถ้าเครื่องไม่มี WebRTC
        // (เช่น Expo Go) แอปส่วนอื่นจะยังใช้งานได้ปกติ
        loaded = await import("../../lib/call-room");
        if (!active) return;
        await loaded.prepareCall();
        const result = await api(`/call/token?room=${encodeURIComponent(room)}`);
        if (!active) return;
        setCallModule(loaded);
        setCredentials(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "เข้าร่วมห้องไม่สำเร็จ");
      }
    }

    void connect();
    return () => {
      active = false;
      loaded?.endCall();
    };
  }, [room]);

  if (error) return <View style={styles.center}><Text style={styles.errorText}>{error}</Text></View>;
  if (!credentials || !callModule) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  const Room = callModule.CallRoom;
  return <Room serverUrl={credentials.url} token={credentials.token} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: "#b42318", textAlign: "center" },
});
