import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "../../lib/api";
import { useTheme, colors, spacing, radius, font, shadow } from "../../lib/theme";
import { Card, SectionHeader, StatCard, EmptyState, Pill } from "../../lib/ui";

type Row = { period: string; pv: number; amount: number };

type Status = {
  rank: string;
  role: string;
  personalPV: number;
  personalAmount: number;
  customerCount: number;
  goalCount: number;
};

type Goal = { id: string; title: string; target: number; current: number; period: string };

const money = (value: number) => `฿${Number(value).toLocaleString("th-TH")}`;

export default function Dashboard() {
  const { color } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<Row[]>("/sales/summary?by=month"),
      api<Status>("/me/status").catch(() => null),
      api<Goal[]>("/goals").catch(() => []),
    ])
      .then(([salesRows, meStatus, goalsData]) => {
        setRows(salesRows);
        setStatus(meStatus);
        setGoals(goalsData);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const totalPV = rows.reduce((a, r) => a + Number(r.pv), 0);
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const avg = rows.length ? total / rows.length : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* การ์ดหลัก */}
      <View style={[styles.hero, { backgroundColor: color }]}>
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>รายได้สะสมทั้งหมด</Text>
          <View style={styles.heroBadge}>
            <Ionicons name="trending-up" size={14} color="#fff" />
          </View>
        </View>
        <Text style={styles.heroValue}>{money(total)}</Text>
        <View style={styles.heroDivider} />
        <View style={styles.heroRow}>
          <View>
            <Text style={styles.heroSubLabel}>PV รวม</Text>
            <Text style={styles.heroSubValue}>{Number(totalPV).toLocaleString("th-TH")}</Text>
          </View>
          <View style={styles.heroDividerV} />
          <View>
            <Text style={styles.heroSubLabel}>เดือนที่มียอด</Text>
            <Text style={styles.heroSubValue}>{rows.length}</Text>
          </View>
        </View>
      </View>

      {/* สถานะธุรกิจ */}
      {status ? (
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <Ionicons name="trophy-outline" size={18} color={color} />
              <Text style={styles.statusLabel}>ระดับธุรกิจ</Text>
            </View>
            <Pill text={status.rank} color={color} />
          </View>
          <View style={styles.statusGrid}>
            <View style={styles.statusCell}>
              <Text style={styles.statusValue}>{Number(status.personalPV).toLocaleString("th-TH")}</Text>
              <Text style={styles.statusCaption}>PV เดือนนี้</Text>
            </View>
            <View style={styles.statusCellDivider} />
            <View style={styles.statusCell}>
              <Text style={styles.statusValue}>{status.customerCount}</Text>
              <Text style={styles.statusCaption}>ลูกค้า</Text>
            </View>
            <View style={styles.statusCellDivider} />
            <View style={styles.statusCell}>
              <Text style={styles.statusValue}>{status.goalCount}</Text>
              <Text style={styles.statusCaption}>เป้าหมาย</Text>
            </View>
          </View>
        </Card>
      ) : null}

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        {[
          { icon: "pricetag-outline" as const, label: "บันทึกการขาย", route: "/products" },
          { icon: "person-add-outline" as const, label: "เพิ่มลูกค้า", route: "/more" },
          { icon: "calendar-outline" as const, label: "นัดประชุม", route: "/more" },
          { icon: "chatbubbles-outline" as const, label: "แชททีม", route: "/chat" },
        ].map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={() => router.push(action.route as any)}
            style={({ pressed }) => [styles.quickAction, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: color + "1a" }]}>
              <Ionicons name={action.icon} size={22} color={color} />
            </View>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* เป้าหมาย */}
      {goals.length > 0 ? (
        <>
          <SectionHeader title="เป้าหมายของฉัน" />
          <View style={styles.list}>
            {goals.map((goal) => {
              const pct = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
              return (
                <Card key={goal.id} style={styles.goalCard}>
                  <View style={styles.goalTop}>
                    <Text style={styles.goalTitle} numberOfLines={1}>
                      {goal.title}
                    </Text>
                    <Pill text={`${pct}%`} color={color} />
                  </View>
                  <View style={styles.goalBarTrack}>
                    <View style={[styles.goalBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                  <Text style={styles.goalMeta}>
                    {money(goal.current)} / {money(goal.target)}
                  </Text>
                </Card>
              );
            })}
          </View>
        </>
      ) : null}

      {/* สถิติ */}
      <View style={styles.stats}>
        <StatCard label="ยอดเฉลี่ย/เดือน" value={money(avg)} color={color} />
        <StatCard label="PV รวม" value={Number(totalPV).toLocaleString("th-TH")} color={colors.accent} />
      </View>

      {/* รายเดือน */}
      <SectionHeader title="ยอดรายเดือน" />
      {loading ? (
        <Card>
          <Text style={font.body}>กำลังโหลด...</Text>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState icon="bar-chart-outline" message="ยังไม่มียอดขาย" sub="เริ่มบันทึกการขายจากเมนูสินค้า" />
      ) : (
        <View style={styles.list}>
          {[...rows].reverse().map((row) => {
            const d = new Date(row.period);
            const label = d.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
            const max = Math.max(...rows.map((r) => Number(r.amount)), 1);
            const pct = Math.round((Number(row.amount) / max) * 100);
            return (
              <Card key={row.period} style={styles.rowCard}>
                <View style={styles.rowTop}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.rowDot, { backgroundColor: color }]} />
                    <Text style={styles.rowMonth}>{label}</Text>
                  </View>
                  <Text style={styles.rowAmount}>{money(row.amount)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
                </View>
                <Text style={styles.rowPV}>{Number(row.pv).toLocaleString("th-TH")} PV</Text>
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadow.raised,
  },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroLabel: { color: "#ffffffd9", fontSize: 14, fontWeight: "500" },
  heroBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#ffffff2e",
    alignItems: "center",
    justifyContent: "center",
  },
  heroValue: { color: "#fff", fontSize: 34, fontWeight: "700", marginTop: spacing.sm },
  heroDivider: { height: 1, backgroundColor: "#ffffff30", marginVertical: spacing.lg },
  heroRow: { flexDirection: "row", alignItems: "center" },
  heroSubLabel: { color: "#ffffffb3", fontSize: 12 },
  heroSubValue: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 2 },
  heroDividerV: { width: 1, height: 32, backgroundColor: "#ffffff30", marginHorizontal: spacing.lg },
  statusCard: { marginBottom: spacing.lg, padding: spacing.lg },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  statusItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusLabel: { ...font.label },
  statusGrid: { flexDirection: "row", alignItems: "center" },
  statusCell: { flex: 1, alignItems: "center" },
  statusCellDivider: { width: 1, height: 28, backgroundColor: colors.border },
  statusValue: { ...font.h3 },
  statusCaption: { ...font.caption, marginTop: 2 },
  stats: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl },
  quickActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  quickAction: { flex: 1, alignItems: "center", gap: 6 },
  quickActionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: { fontSize: 11, fontWeight: "600", color: colors.textSecondary, textAlign: "center" },
  goalCard: { padding: spacing.lg, marginBottom: spacing.md },
  goalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  goalTitle: { ...font.title, flex: 1, marginRight: spacing.sm },
  goalBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  goalBarFill: { height: 8, borderRadius: 4 },
  goalMeta: { ...font.caption, marginTop: spacing.sm },
  list: { gap: spacing.md },
  rowCard: { padding: spacing.lg },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowDot: { width: 10, height: 10, borderRadius: 5 },
  rowMonth: { ...font.title },
  rowAmount: { ...font.h3 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  rowPV: { ...font.caption, marginTop: spacing.sm },
});
