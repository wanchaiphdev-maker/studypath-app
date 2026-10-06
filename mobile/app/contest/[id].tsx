import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { useTheme, colors, radius, font, shadow, spacing } from "../../lib/theme";
import { Avatar, Card, EmptyState, Pill } from "../../lib/ui";

type Row = {
  id: string;
  name: string;
  rank: string;
  personal: { amount: number; pv: number };
  group: { amount: number; pv: number; downlineCount: number };
  position: number;
  award: string;
  downlinePV?: number;
  bonus?: number;
};

type Contest = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  bigUplineTopN: number;
  bigUplineBonus: number;
  status: "UPCOMING" | "ACTIVE" | "ENDED";
};

type Board = {
  contest: Contest;
  top: Row[];
  bigUpline: Row[];
  total: number;
  myRank: number | null;
  myPV: number;
  myGroupRank: number | null;
};

const STATUS_LABEL: Record<Contest["status"], string> = {
  UPCOMING: "กำลังจะมา",
  ACTIVE: "กำลังเข้าร่วม",
  ENDED: "จบแล้ว",
};

const MEDALS = ["#f5b301", "#9aa5b1", "#c98a5b"];
const PODIUM_ORDER = [1, 0, 2];

const money = (v: number) => `฿${Number(v).toLocaleString("th-TH")}`;
const pv = (v: number) => `${Number(v).toLocaleString("th-TH")} PV`;

function daysLeft(endDate: string) {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return "ปิดรับสมัครแล้ว";
  const d = Math.ceil(diff / 86_400_000);
  return `เหลืออีก ${d} วัน`;
}

export default function ContestBoardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"top" | "big">("top");

  const load = useCallback(async () => {
    try {
      setBoard(await api<Board>(`/contest/${id}/leaderboard`));
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  if (!board) {
    return (
      <View style={styles.center}>
        <EmptyState icon="trophy-outline" message="ไม่พบประกวดนี้" sub="อาจถูกลบไปแล้ว" />
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color }]}>กลับ</Text>
        </Pressable>
      </View>
    );
  }

  const { contest } = board;
  const podium = board.top.slice(0, 3);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      {/* แถบหัวเรื่อง */}
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
        <Text style={styles.navTitle} numberOfLines={1}>
          กระดานจัดอันดับ
        </Text>
        <View style={styles.navBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* หัวข้อประกวด */}
        <View style={[styles.hero, { backgroundColor: color }]}>
          <View style={styles.heroTop}>
            <Ionicons name="trophy" size={22} color="#fff" />
            <Text style={styles.heroName} numberOfLines={2}>
              {contest.name}
            </Text>
          </View>
          <View style={styles.heroMeta}>
            <Pill text={STATUS_LABEL[contest.status]} color="#fff" />
            <Text style={styles.heroMetaText}>
              {contest.status === "ACTIVE"
                ? daysLeft(contest.endDate)
                : new Date(contest.endDate).toLocaleDateString("th-TH", {
                    day: "numeric",
                    month: "short",
                    year: "2-digit",
                  })}
            </Text>
          </View>
        </View>

        {/* อันดับของฉัน */}
        {board.myRank ? (
          <Card style={styles.myCard}>
            <View style={styles.myLeft}>
              <Text style={styles.myLabel}>อันดับของคุณ</Text>
              <Text style={styles.myRank}>
                #{board.myRank}
                <Text style={styles.myRankOf}> / {board.total}</Text>
              </Text>
            </View>
            <View style={styles.myRight}>
              <Text style={styles.myPV}>{pv(board.myPV)}</Text>
              {board.myGroupRank ? (
                <Text style={styles.myTeamRank}>ทีมอันดับ #{board.myGroupRank}</Text>
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* แท็บสลับ */}
        <View style={styles.tabRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTab("top")}
            style={[styles.tab, tab === "top" && { backgroundColor: color }]}
          >
            <Text style={[styles.tabText, tab === "top" && styles.tabTextOn]}>Top Seller</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTab("big")}
            style={[styles.tab, tab === "big" && { backgroundColor: color }]}
          >
            <Text style={[styles.tabText, tab === "big" && styles.tabTextOn]}>Big Upline</Text>
          </Pressable>
        </View>

        {tab === "top" ? (
          board.top.length === 0 ? (
            <EmptyState icon="podium-outline" message="ยังไม่มียอดขายในประกวดนี้" />
          ) : (
            <>
              {/* โปเดียม 3 อันดับ */}
              {podium.length >= 3 ? (
                <View style={styles.podium}>
                  {PODIUM_ORDER.map((idx) => {
                    const m = podium[idx];
                    const h = idx === 0 ? 96 : 68;
                    return (
                      <View key={m.id} style={styles.podiumCol}>
                        <Avatar name={m.name} color={color} size={idx === 0 ? 52 : 42} />
                        <Text style={styles.podiumName} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <Text style={styles.podiumPV}>{pv(m.personal.pv)}</Text>
                        <View style={[styles.podiumBar, { height: h, backgroundColor: MEDALS[idx] }]}>
                          <Text style={styles.podiumPos}>{m.position}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* ตารางอันดับ */}
              <Card style={styles.listCard}>
                {board.top.map((m) => (
                  <View key={m.id} style={styles.listRow}>
                    <Text
                      style={[
                        styles.listPos,
                        m.position <= 3 && { color: MEDALS[m.position - 1] },
                      ]}
                    >
                      {m.position}
                    </Text>
                    <Avatar name={m.name} color={color} size={34} />
                    <View style={styles.listInfo}>
                      <Text style={styles.listName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text style={styles.listSub} numberOfLines={1}>
                        ยอดขาย {money(m.personal.amount)}
                      </Text>
                    </View>
                    <Text style={[styles.listPV, { color }]}>{pv(m.personal.pv)}</Text>
                  </View>
                ))}
              </Card>
            </>
          )
        ) : board.bigUpline.length === 0 ? (
          <EmptyState icon="git-network-outline" message="ยังไม่มีรางวัล Big Upline" sub="ต้องมีสายล่างอย่างน้อย 1 คน" />
        ) : (
          <Card style={styles.listCard}>
            {board.bigUpline.map((m) => (
              <View key={m.id} style={styles.listRow}>
                <Text style={[styles.listPos, m.position === 1 && { color: MEDALS[0] }]}>
                  {m.position}
                </Text>
                <Avatar name={m.name} color={color} size={34} />
                <View style={styles.listInfo}>
                  <Text style={styles.listName} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={styles.listSub} numberOfLines={1}>
                    {m.group.downlineCount} คนในสาย · PV สายล่าง {pv(m.downlinePV ?? 0)}
                  </Text>
                </View>
                <View style={styles.bonusBox}>
                  <Text style={styles.bonusText}>{money(m.bonus ?? 0)}</Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  backBtn: { marginTop: spacing.md },
  backText: { fontWeight: "600" },

  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  navBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  navTitle: { ...font.h3, flex: 1, textAlign: "center" },

  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  hero: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadow.raised },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  heroName: { color: "#fff", fontSize: 20, fontWeight: "700", flex: 1 },
  heroMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroMetaText: { color: "#ffffffe0", fontSize: 13 },

  myCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  myLeft: { gap: 2 },
  myLabel: { ...font.caption },
  myRank: { fontSize: 26, fontWeight: "800", color: colors.text },
  myRankOf: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  myRight: { alignItems: "flex-end", gap: 2 },
  myPV: { fontSize: 16, fontWeight: "700", color: colors.text },
  myTeamRank: { ...font.caption },

  tabRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.full,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  tabTextOn: { color: "#fff" },

  podium: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  podiumCol: { flex: 1, alignItems: "center", gap: 4 },
  podiumName: { ...font.label, fontWeight: "700", maxWidth: 100 },
  podiumPV: { ...font.caption },
  podiumBar: {
    width: "100%",
    maxWidth: 88,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 6,
  },
  podiumPos: { color: "#fff", fontSize: 20, fontWeight: "800" },

  listCard: { padding: spacing.md, gap: spacing.xs },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  listPos: { width: 22, textAlign: "center", fontSize: 15, fontWeight: "800", color: colors.textMuted },
  listInfo: { flex: 1, gap: 1 },
  listName: { ...font.label, fontWeight: "700", color: colors.text },
  listSub: { ...font.caption },
  listPV: { fontSize: 13, fontWeight: "700" },

  bonusBox: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: "#f5b3011a",
  },
  bonusText: { fontSize: 12, fontWeight: "800", color: "#b07c00" },
});