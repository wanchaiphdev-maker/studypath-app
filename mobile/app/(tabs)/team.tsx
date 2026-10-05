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
import { useTheme } from "../../lib/theme";

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
          <Text style={styles.section}>รายชื่อสมาชิก ({members.length})</Text>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีสมาชิกในสายงาน</Text>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: item.themeColor }]}>
            <Text style={styles.avatarText}>{item.name.trim().charAt(0)}</Text>
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {ROLE_LABEL[item.role]} · {money(item.group.downlineCount)} คนใต้บังคับบัญชา
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.amount}>฿{money(item.group.amount)}</Text>
            <Text style={styles.pv}>{money(item.group.pv)} PV</Text>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f7f5" },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#17231f", marginBottom: 12 },
  error: { color: "#b42318", marginBottom: 8 },
  card: { borderRadius: 16, padding: 20, marginBottom: 16 },
  cardLabel: { color: "#ffffffcc", fontSize: 13 },
  cardValue: { color: "#fff", fontSize: 30, fontWeight: "700", marginTop: 4 },
  cardSub: { color: "#ffffffe6", fontSize: 13, marginTop: 2 },
  cardDivider: { height: 1, backgroundColor: "#ffffff40", marginVertical: 10 },
  section: { fontSize: 15, fontWeight: "700", color: "#3d4f49", marginBottom: 8 },
  empty: { color: "#6b7c76", paddingVertical: 24, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3eae7",
    padding: 12,
    marginBottom: 8,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  rowMain: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: "600", color: "#17231f" },
  meta: { fontSize: 12, color: "#6b7c76", marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  amount: { fontSize: 15, fontWeight: "700", color: "#17231f" },
  pv: { fontSize: 12, color: "#6b7c76", marginTop: 2 },
});
