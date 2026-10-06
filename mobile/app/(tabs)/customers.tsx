import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { useTheme, colors, spacing, radius, font, shadow } from "../../lib/theme";
import { Avatar, Button, Card, EmptyState } from "../../lib/ui";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  createdAt: string;
};

export default function CustomersScreen() {
  const { color } = useTheme();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setCustomers(await api<Customer[]>("/customers"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดลูกค้าไม่สำเร็จ");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const save = useCallback(async () => {
    if (saving || !formName.trim()) return;
    setSaving(true);
    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({ name: formName, phone: formPhone, email: formEmail, note: formNote }),
      });
      setFormOpen(false);
      setFormName("");
      setFormPhone("");
      setFormEmail("");
      setFormNote("");
      await load();
    } catch (cause) {
      Alert.alert("บันทึกไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }, [formName, formPhone, formEmail, formNote, load, saving]);

  const remove = useCallback(
    (customer: Customer) => {
      Alert.alert("ลบลูกค้า", `ต้องการลบ "${customer.name}" ใช่หรือไม่?`, [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/customers/${customer.id}`, { method: "DELETE" });
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ลูกค้า</Text>
          <Text style={styles.subtitle}>{customers.length} คน</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setFormOpen(true)} style={[styles.addBtn, { backgroundColor: color }]}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={customers}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
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
        ListEmptyComponent={<EmptyState icon="people-outline" message="ยังไม่มีลูกค้า" sub="กดปุ่ม + เพื่อเพิ่มลูกค้า" />}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <Avatar name={item.name} color={color} size={44} />
            <View style={styles.rowMain}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.phone ? (
                <View style={styles.metaRow}>
                  <Ionicons name="call-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.phone}
                  </Text>
                </View>
              ) : null}
              {item.note ? (
                <Text style={styles.note} numberOfLines={1}>
                  {item.note}
                </Text>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => remove(item)}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          </Card>
        )}
      />

      {/* เพิ่มลูกค้า */}
      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>เพิ่มลูกค้า</Text>
            <TextInput
              placeholder="ชื่อลูกค้า"
              value={formName}
              onChangeText={setFormName}
              style={styles.input}
            />
            <TextInput
              placeholder="เบอร์โทร (ไม่บังคับ)"
              value={formPhone}
              onChangeText={setFormPhone}
              keyboardType="phone-pad"
              style={styles.input}
            />
            <TextInput
              placeholder="อีเมล (ไม่บังคับ)"
              value={formEmail}
              onChangeText={setFormEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              placeholder="หมายเหตุ (ไม่บังคับ)"
              value={formNote}
              onChangeText={setFormNote}
              style={styles.input}
            />
            <View style={styles.dialogActions}>
              <Button variant="ghost" onPress={() => setFormOpen(false)}>
                ยกเลิก
              </Button>
              <Button onPress={() => void save()} disabled={!formName.trim()} loading={saving}>
                เพิ่มลูกค้า
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { ...font.h1 },
  subtitle: { ...font.caption, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md, padding: spacing.md },
  rowMain: { flex: 1 },
  name: { ...font.title },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  meta: { ...font.label },
  note: { ...font.caption, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "#0009", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  dialog: { width: "100%", maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, ...shadow.raised },
  dialogTitle: { ...font.h3 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
});
