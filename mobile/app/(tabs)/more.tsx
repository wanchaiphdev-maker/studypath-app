import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { api } from "../../lib/api";
import { closeSocket } from "../../lib/socket";
import { useTheme, colors, spacing, radius, font, shadow } from "../../lib/theme";
import { Avatar, Card, Pill } from "../../lib/ui";

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
      {/* โปรไฟล์ */}
      {me ? (
        <View style={[styles.profile, { backgroundColor: color }]}>
          <Avatar name={me.name} color="#ffffff33" size={56} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{me.name}</Text>
            <Text style={styles.profileEmail}>{me.email}</Text>
            <View style={{ marginTop: 8 }}>
              <Pill text={ROLE_LABEL[me.role]} color="#fff" />
            </View>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* สีธีม */}
      <Text style={styles.section}>สีธีมของแอป</Text>
      <Card>
        <View style={styles.colorRow}>
          {COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityRole="button"
              accessibilityLabel={`เลือกสี ${swatch}`}
              disabled={saving}
              onPress={() => void pickColor(swatch)}
              style={[
                styles.swatch,
                { backgroundColor: swatch, borderColor: me?.themeColor === swatch ? colors.text : "#ffffff00" },
              ]}
            >
              {me?.themeColor === swatch ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
            </Pressable>
          ))}
        </View>
      </Card>

      {/* ออกจากระบบ */}
      <Pressable accessibilityRole="button" onPress={logout} style={styles.logoutBtn}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>ออกจากระบบ</Text>
      </Pressable>

      <Text style={styles.footer}>Amway Team</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, marginBottom: spacing.sm },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.lg,
    marginBottom: spacing.xl,
    ...shadow.raised,
  },
  profileInfo: { flex: 1 },
  profileName: { color: "#fff", fontSize: 20, fontWeight: "700" },
  profileEmail: { color: "#ffffffd9", fontSize: 13, marginTop: 2 },
  section: { ...font.h3, marginBottom: spacing.md },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.xl,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#f0c9c6",
    backgroundColor: "#fdf3f2",
  },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  footer: { ...font.caption, textAlign: "center", marginTop: spacing.xxl },
});
