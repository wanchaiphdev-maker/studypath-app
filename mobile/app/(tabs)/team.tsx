import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "../../lib/api";
import { useTheme, colors, spacing, radius, font, shadow } from "../../lib/theme";
import { Avatar, Card, EmptyState, Pill } from "../../lib/ui";

type Member = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "LEADER" | "MEMBER";
  themeColor: string;
  uplineId: string | null;
  personal: { amount: number; pv: number };
  group: { amount: number; pv: number; downlineCount: number };
};

const ROLE_LABEL: Record<Member["role"], string> = {
  ADMIN: "แอดมิน",
  LEADER: "หัวหน้าทีม",
  MEMBER: "สมาชิก",
};

const money = (value: number) => Number(value).toLocaleString("th-TH");

export default function TeamScreen() {
  const { color } = useTheme();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await api("/team/members"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดรายชื่อทีมไม่สำเร็จ");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // เลื่อนไป microtask: กันการ setState แบบซิงโครนัสใน effect (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
  }, [load]);

  const me = members[0];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={members}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={color}
        />
      }
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>ทีมของฉัน</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {me ? (
            <View style={[styles.card, { backgroundColor: color }]}>
              <Text style={styles.cardLabel}>ยอดทีมรวม (เดือนนี้)</Text>
              <Text style={styles.cardValue}>฿{money(me.group.amount)}</Text>
              <Text style={styles.cardSub}>
                {money(me.group.pv)} PV · {me.group.downlineCount} คนในสายงาน
              </Text>
              <View style={styles.cardDivider} />
              <Text style={styles.cardSub}>
                ยอดส่วนตัว ฿{money(me.personal.amount)} / {money(me.personal.pv)} PV
              </Text>
            </View>
          ) : null}
          <View style={styles.sectionRow}>
            <Text style={styles.section}>รายชื่อสมาชิก</Text>
            <Pill text={`${members.length} คน`} />
          </View>
        </View>
      }
      ListEmptyComponent={<EmptyState icon="people-outline" message="ยังไม่มีสมาชิกในสายงาน" />}
      renderItem={({ item }) => (
        <Card style={styles.row}>
          <View style={styles.rowTop}>
            <Avatar name={item.name} color={item.themeColor} size={48} />
            <View style={styles.rowMain}>
              <View style={styles.rowNameLine}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Pill text={ROLE_LABEL[item.role]} />
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {money(item.group.downlineCount)} คนใต้บังคับบัญชา
              </Text>
            </View>
          </View>
          <View style={styles.rowStats}>
            <View style={styles.rowStat}>
              <Text style={styles.rowStatValue}>฿{money(item.personal.amount)}</Text>
              <Text style={styles.rowStatLabel}>ส่วนตัว</Text>
            </View>
            <View style={styles.rowStatDivider} />
            <View style={styles.rowStat}>
              <Text style={styles.rowStatValue}>฿{money(item.group.amount)}</Text>
              <Text style={styles.rowStatLabel}>ทีม</Text>
            </View>
            <View style={styles.rowStatDivider} />
            <View style={styles.rowStat}>
              <Text style={styles.rowStatValue}>{money(item.group.pv)}</Text>
              <Text style={styles.rowStatLabel}>PV</Text>
            </View>
          </View>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { ...font.h1, marginBottom: spacing.md },
  error: { color: colors.danger, marginBottom: spacing.sm },
  card: { borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.lg, ...shadow.raised },
  cardLabel: { color: "#ffffffcc", fontSize: 13 },
  cardValue: { color: "#fff", fontSize: 30, fontWeight: "700", marginTop: spacing.xs },
  cardSub: { color: "#ffffffe6", fontSize: 13, marginTop: 2 },
  cardDivider: { height: 1, backgroundColor: "#ffffff40", marginVertical: spacing.md },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  section: { ...font.h3 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowMain: { flex: 1 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...font.title, flexShrink: 1 },
  meta: { ...font.caption, marginTop: 2 },
  rowStats: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowStat: { flex: 1, alignItems: "center" },
  rowStatDivider: { width: 1, height: 24, backgroundColor: colors.border },
  rowStatValue: { ...font.title },
  rowStatLabel: { ...font.caption, marginTop: 2 },
});
