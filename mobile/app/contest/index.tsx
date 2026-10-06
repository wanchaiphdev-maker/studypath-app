import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { useTheme, colors, radius, font, shadow, spacing } from "../../lib/theme";
import { Card, EmptyState, Pill } from "../../lib/ui";

type Contest = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  bigUplineTopN: number;
  bigUplineBonus: number;
  status: "UPCOMING" | "ACTIVE" | "ENDED";
};

type Me = { role: "ADMIN" | "LEADER" | "MEMBER" };

const STATUS_LABEL: Record<Contest["status"], string> = {
  UPCOMING: "กำลังจะมา",
  ACTIVE: "กำลังเข้าร่วม",
  ENDED: "จบแล้ว",
};

const STATUS_COLOR: Record<Contest["status"], string> = {
  UPCOMING: colors.textMuted,
  ACTIVE: "#147d64",
  ENDED: "#b7791f",
};

const money = (v: number) => `฿${Number(v).toLocaleString("th-TH")}`;

function fmtRange(a: string, b: string) {
  const d = (x: string) =>
    new Date(x).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  return `${d(a)} - ${d(b)}`;
}

function daysLeft(endDate: string) {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return "ปิดรับสมัครแล้ว";
  return `เหลืออีก ${Math.ceil(diff / 86_400_000)} วัน`;
}

export default function ContestListScreen() {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Contest[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [bonus, setBonus] = useState("1000");
  const [topN, setTopN] = useState("3");

  const canManage = me?.role === "ADMIN" || me?.role === "LEADER";

  const load = useCallback(async () => {
    const [list, meData] = await Promise.all([
      api<Contest[]>("/contest").catch(() => []),
      api<Me>("/me").catch(() => null),
    ]);
    setItems(list);
    setMe(meData);
    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const create = useCallback(async () => {
    if (saving || !name.trim() || !start.trim() || !end.trim()) return;
    setSaving(true);
    try {
      await api("/contest", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          startDate: start.trim(),
          endDate: end.trim(),
          bigUplineBonus: Number(bonus) || 0,
          bigUplineTopN: Number(topN) || 3,
        }),
      });
      setOpen(false);
      setName("");
      setStart("");
      setEnd("");
      Alert.alert("สำเร็จ", "สร้างประกวดเรียบร้อยแล้ว");
      await load();
    } catch (cause) {
      Alert.alert("สร้างไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }, [bonus, end, load, name, saving, start, topN]);

  const remove = useCallback(
    (c: Contest) => {
      Alert.alert("ลบประกวด", `ต้องการลบ "${c.name}" ใช่หรือไม่?`, [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/contest/${c.id}`, { method: "DELETE" });
              await load();
            } catch (cause) {
              Alert.alert("ลบไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
            }
          },
        },
      ]);
    },
    [load],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  const active = items.find((c) => c.status === "ACTIVE");

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.navRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="กลับ"
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.navBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.navTitle}>ประกวด</Text>
        {canManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="สร้างประกวด"
            onPress={() => setOpen(true)}
            hitSlop={10}
            style={[styles.navBtn, { backgroundColor: color + "1a" }]}
          >
            <Ionicons name="add" size={22} color={color} />
          </Pressable>
        ) : (
          <View style={styles.navBtn} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`เปิดกระดานจัดอันดับ ${active.name}`}
            onPress={() => router.push(`/contest/${active.id}`)}
            style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
          >
            <View style={[styles.activeCard, { backgroundColor: color }]}>
              <View style={styles.activeTop}>
                <Ionicons name="trophy" size={20} color="#fff" />
                <Text style={styles.activeLabel}>ประกวดที่กำลังเข้าร่วม</Text>
              </View>
              <Text style={styles.activeName} numberOfLines={2}>
                {active.name}
              </Text>
              <View style={styles.activeFoot}>
                <Text style={styles.activeMeta}>{daysLeft(active.endDate)}</Text>
                <View style={styles.activeGo}>
                  <Text style={styles.activeGoText}>ดูกระดาน</Text>
                  <Ionicons name="chevron-forward" size={16} color={color} />
                </View>
              </View>
            </View>
          </Pressable>
        ) : null}

        {items.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            message="ยังไม่มีประกวด"
            sub={canManage ? "กดปุ่ม + เพื่อสร้างประกวดแรก" : "เดี๋ยวหัวหน้าทีมจะประกาศเร็วๆ นี้"}
          />
        ) : (
          <Card style={styles.listCard}>
            {items.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={c.name}
                onPress={() => router.push(`/contest/${c.id}`)}
                style={styles.row}
              >
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: (STATUS_COLOR[c.status] ?? colors.textMuted) + "1a" },
                  ]}
                >
                  <Ionicons
                    name={c.status === "ACTIVE" ? "trophy" : c.status === "UPCOMING" ? "time-outline" : "checkmark-done"}
                    size={18}
                    color={STATUS_COLOR[c.status] ?? colors.textMuted}
                  />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {fmtRange(c.startDate, c.endDate)}
                  </Text>
                </View>
                <Pill text={STATUS_LABEL[c.status]} color={STATUS_COLOR[c.status] ?? colors.textMuted} />
                {canManage ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`ลบ ${c.name}`}
                    onPress={() => remove(c)}
                    hitSlop={8}
                    style={styles.delBtn}
                  >
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </Card>
        )}

        {active ? (
          <Text style={styles.hint}>
            รางวัล Big Upline สูงสุด {active.bigUplineTopN} รางวัล คนละ {money(active.bigUplineBonus)}
          </Text>
        ) : null}
      </ScrollView>

      {/* สร้างประกวด */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>สร้างประกวด</Text>
            <TextInput
              placeholder="ชื่อประกวด"
              value={name}
              onChangeText={setName}
              style={styles.input}
            />
            <TextInput
              placeholder="วันเริ่ม เช่น 2026-10-01"
              value={start}
              onChangeText={setStart}
              style={styles.input}
            />
            <TextInput
              placeholder="วันสิ้นสุด เช่น 2026-10-31"
              value={end}
              onChangeText={setEnd}
              style={styles.input}
            />
            <View style={styles.twoCol}>
              <TextInput
                placeholder="จำนวนรางวัล Big Upline"
                value={topN}
                onChangeText={setTopN}
                keyboardType="number-pad"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                placeholder="เงินรางวัล"
                value={bonus}
                onChangeText={setBonus}
                keyboardType="number-pad"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.ghostBtn}>
                <Text style={styles.ghostText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving || !name.trim() || !start.trim() || !end.trim()}
                onPress={() => void create()}
                style={[styles.primaryBtn, { backgroundColor: color }]}
              >
                <Text style={styles.primaryText}>{saving ? "กำลังสร้าง..." : "สร้าง"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },

  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  navBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  navTitle: { ...font.h3, flex: 1, textAlign: "center" },

  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  activeCard: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadow.raised },
  activeTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  activeLabel: { color: "#ffffffe0", fontSize: 13, fontWeight: "600" },
  activeName: { color: "#fff", fontSize: 20, fontWeight: "700" },
  activeFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  activeMeta: { color: "#ffffffe0", fontSize: 13 },
  activeGo: { flexDirection: "row", alignItems: "center", gap: 2 },
  activeGoText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  listCard: { padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  rowInfo: { flex: 1, gap: 1 },
  rowName: { ...font.label, fontWeight: "700", color: colors.text },
  rowSub: { ...font.caption },
  delBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },

  hint: { ...font.caption, textAlign: "center", paddingHorizontal: spacing.lg },

  backdrop: {
    flex: 1,
    backgroundColor: "#0009",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  dialog: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadow.raised,
  },
  dialogTitle: { ...font.h3 },
  twoCol: { flexDirection: "row", gap: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  ghostBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  ghostText: { color: colors.textSecondary, fontWeight: "600" },
  primaryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
});