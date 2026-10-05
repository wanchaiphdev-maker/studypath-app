import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { api, BASE_URL } from "../../lib/api";
import { closeSocket } from "../../lib/socket";
import { useTheme } from "../../lib/theme";

type Me = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "LEADER" | "MEMBER";
  themeColor: string;
};

const ROLE_LABEL: Record<Me["role"], string> = {
  ADMIN: "แอดมิน",
  LEADER: "หัวหน้าทีม",
  MEMBER: "สมาชิก",
};

const COLORS = ["#2563eb", "#147d64", "#7c3aed", "#db2777", "#ea580c", "#0891b2"];

export default function MoreScreen() {
  const { color, setColor } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดโปรไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // เลื่อนไป microtask: กันการ setState แบบซิงโครนัสใน effect (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
  }, [load]);

  const pickColor = useCallback(
    async (next: string) => {
      if (!me || saving || next === me.themeColor) return;
      const previous = me.themeColor;
      setColor(next);
      setMe({ ...me, themeColor: next });
      setSaving(true);
      try {
        await api("/me", { method: "PATCH", body: JSON.stringify({ themeColor: next }) });
      } catch (cause) {
        setColor(previous);
        setMe({ ...me, themeColor: previous });
        setError(cause instanceof Error ? cause.message : "บันทึกสีไม่สำเร็จ");
      } finally {
        setSaving(false);
      }
    },
    [me, setColor, saving],
  );

  const logout = useCallback(() => {
    Alert.alert("ออกจากระบบ", "ต้องการออกจากระบบใช่หรือไม่?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ออกจากระบบ",
        style: "destructive",
        onPress: async () => {
          closeSocket();
          await SecureStore.deleteItemAsync("token").catch(() => undefined);
          router.replace("/(auth)/login");
        },
      },
    ]);
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>เพิ่มเติม</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {me ? (
        <View style={[styles.profile, { backgroundColor: color }]}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitial}>{me.name.trim().charAt(0)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{me.name}</Text>
            <Text style={styles.profileEmail}>{me.email}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>{ROLE_LABEL[me.role]}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <Text style={styles.section}>สีธีมของแอป</Text>
      <View style={styles.colorRow}>
        {COLORS.map(swatch => (
          <Pressable
            key={swatch}
            accessibilityRole="button"
            accessibilityLabel={`เลือกสี ${swatch}`}
            disabled={saving}
            onPress={() => void pickColor(swatch)}
            style={[
              styles.swatch,
              { backgroundColor: swatch, borderColor: me?.themeColor === swatch ? "#17231f" : "#ffffff00" },
            ]}
          >
            {me?.themeColor === swatch ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>บัญชี</Text>
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>อีเมล</Text>
          <Text style={styles.infoValue}>{me?.email ?? "-"}</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>เซิร์ฟเวอร์</Text>
          <Text style={styles.infoValue}>{BASE_URL ?? "ยังไม่ได้ตั้งค่า"}</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>เวอร์ชัน</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
      </View>

      <Pressable accessibilityRole="button" onPress={logout} style={styles.logoutBtn}>
        <Ionicons name="log-out-outline" size={18} color="#b42318" />
        <Text style={styles.logoutText}>ออกจากระบบ</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f7f5" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#17231f", marginBottom: 12 },
  error: { color: "#b42318", marginBottom: 8 },
  profile: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 18, gap: 14 },
  profileAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#ffffff33",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitial: { color: "#fff", fontSize: 24, fontWeight: "700" },
  profileName: { color: "#fff", fontSize: 18, fontWeight: "700" },
  profileEmail: { color: "#ffffffe6", fontSize: 13, marginTop: 2 },
  rolePill: {
    alignSelf: "flex-start",
    backgroundColor: "#ffffff2e",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 8,
  },
  roleText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  section: { fontSize: 15, fontWeight: "700", color: "#3d4f49", marginTop: 22, marginBottom: 10 },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3eae7",
    paddingHorizontal: 14,
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 13, gap: 12 },
  infoLabel: { fontSize: 13, color: "#6b7c76" },
  infoValue: { fontSize: 13, color: "#17231f", flexShrink: 1, textAlign: "right" },
  infoDivider: { height: 1, backgroundColor: "#eef3f1" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f0c9c6",
    backgroundColor: "#fdf3f2",
  },
  logoutText: { color: "#b42318", fontWeight: "700" },
});
