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
import { Card, Button, EmptyState } from "../../lib/ui";

type Product = {
  id: string;
  name: string;
  price: string | number;
  pv: string | number;
  note: string | null;
};

const money = (value: string | number) => Number(value).toLocaleString("th-TH");

export default function ProductsScreen() {
  const { color } = useTheme();
  const [products, setProducts] = useState<Product[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [picker, setPicker] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formPv, setFormPv] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([api<Product[]>("/products"), api<{ role: string }>("/me")]);
      setProducts(list);
      setIsAdmin(me.role === "ADMIN");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดสินค้าไม่สำเร็จ");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // เลื่อนไป microtask: กันการ setState แบบซิงโครนัสใน effect (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
  }, [load]);

  const recordSale = useCallback(async () => {
    if (!picker || saving) return;
    setSaving(true);
    try {
      await api("/sales", {
        method: "POST",
        body: JSON.stringify({ items: [{ productId: picker.id, qty }] }),
      });
      setPicker(null);
      setQty(1);
      Alert.alert("บันทึกการขายแล้ว", `${picker.name} x ${qty}`);
    } catch (cause) {
      Alert.alert("บันทึกไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }, [picker, qty, saving]);

  const saveProduct = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api("/products", {
        method: "POST",
        body: JSON.stringify({ name: formName, price: formPrice, pv: formPv }),
      });
      setFormOpen(false);
      setFormName("");
      setFormPrice("");
      setFormPv("");
      await load();
    } catch (cause) {
      Alert.alert("บันทึกไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }, [formName, formPrice, formPv, load, saving]);

  const removeProduct = useCallback(
    (product: Product) => {
      Alert.alert("ลบสินค้า", `ต้องการลบ "${product.name}" ใช่หรือไม่?`, [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/products/${product.id}`, { method: "DELETE" });
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
          <Text style={styles.title}>สินค้า</Text>
          <Text style={styles.subtitle}>{products.length} รายการ</Text>
        </View>
        {isAdmin ? (
          <Pressable accessibilityRole="button" onPress={() => setFormOpen(true)} style={[styles.addBtn, { backgroundColor: color }]}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={products}
        keyExtractor={product => product.id}
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
        ListEmptyComponent={<EmptyState icon="pricetag-outline" message="ยังไม่มีสินค้าในระบบ" sub="กดปุ่ม + เพื่อเพิ่มสินค้า" />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPicker(item);
              setQty(1);
            }}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.cardMain}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {money(item.price)} บาท · {money(item.pv)} PV
              </Text>
              {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
            </View>
            {isAdmin ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => removeProduct(item)}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            )}
          </Pressable>
        )}
      />

      {/* บันทึกการขาย */}
      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{picker?.name}</Text>
            <Text style={styles.dialogMeta}>
              {picker ? `${money(picker.price)} บาท · ${money(picker.pv)} PV` : ""}
            </Text>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" onPress={() => setQty(current => Math.max(1, current - 1))} style={styles.stepBtn}>
                <Ionicons name="remove" size={20} color="#17231f" />
              </Pressable>
              <Text style={styles.qty}>{qty}</Text>
              <Pressable accessibilityRole="button" onPress={() => setQty(current => current + 1)} style={styles.stepBtn}>
                <Ionicons name="add" size={20} color="#17231f" />
              </Pressable>
            </View>
            {picker ? (
              <Text style={styles.total}>รวม ฿{money(Number(picker.price) * qty)}</Text>
            ) : null}
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setPicker(null)} style={styles.ghostBtn}>
                <Text style={styles.ghostText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void recordSale()}
                style={[styles.primaryBtn, { backgroundColor: color }]}
              >
                <Text style={styles.primaryText}>{saving ? "กำลังบันทึก..." : "บันทึกการขาย"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* เพิ่มสินค้า (แอดมิน) */}
      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>เพิ่มสินค้า</Text>
            <TextInput
              placeholder="ชื่อสินค้า"
              value={formName}
              onChangeText={setFormName}
              style={styles.input}
            />
            <TextInput
              placeholder="ราคา (บาท)"
              value={formPrice}
              onChangeText={setFormPrice}
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              placeholder="PV (เว้นว่าง = ใช้ราคา)"
              value={formPv}
              onChangeText={setFormPv}
              keyboardType="numeric"
              style={styles.input}
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setFormOpen(false)} style={styles.ghostBtn}>
                <Text style={styles.ghostText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving || !formName || !formPrice}
                onPress={() => void saveProduct()}
                style={[styles.primaryBtn, { backgroundColor: color, opacity: saving || !formName || !formPrice ? 0.55 : 1 }]}
              >
                <Text style={styles.primaryText}>บันทึก</Text>
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
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardMain: { flex: 1, marginRight: spacing.sm },
  name: { ...font.title },
  meta: { ...font.label, marginTop: 2 },
  note: { ...font.caption, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "#0009", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  dialog: { width: "100%", maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, ...shadow.raised },
  dialogTitle: { ...font.h3 },
  dialogMeta: { ...font.label },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg, marginVertical: spacing.sm },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  qty: { fontSize: 20, fontWeight: "700", color: colors.text, minWidth: 40, textAlign: "center" },
  total: { ...font.title, textAlign: "center" },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md, marginTop: spacing.sm },
  ghostBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  ghostText: { color: colors.textSecondary, fontWeight: "600" },
  primaryBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700" },
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
