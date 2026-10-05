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
import { useTheme } from "../../lib/theme";

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
        <Text style={styles.title}>สินค้า</Text>
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
        ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีสินค้าในระบบ</Text>}
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
                <Ionicons name="trash-outline" size={20} color="#b42318" />
              </Pressable>
            ) : (
              <Ionicons name="chevron-forward" size={18} color="#8fa39c" />
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
  screen: { flex: 1, backgroundColor: "#f4f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: "700", color: "#17231f" },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  error: { color: "#b42318", paddingHorizontal: 16, marginBottom: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { color: "#6b7c76", textAlign: "center", paddingVertical: 32 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3eae7",
    padding: 14,
    marginBottom: 8,
  },
  cardMain: { flex: 1, marginRight: 8 },
  name: { fontSize: 15, fontWeight: "600", color: "#17231f" },
  meta: { fontSize: 13, color: "#6b7c76", marginTop: 3 },
  note: { fontSize: 12, color: "#8fa39c", marginTop: 3 },
  backdrop: { flex: 1, backgroundColor: "#0009", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 400, backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 10 },
  dialogTitle: { fontSize: 18, fontWeight: "700", color: "#17231f" },
  dialogMeta: { fontSize: 13, color: "#6b7c76" },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginVertical: 6 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#cbd6d1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f7f5",
  },
  qty: { fontSize: 20, fontWeight: "700", color: "#17231f", minWidth: 40, textAlign: "center" },
  total: { fontSize: 15, fontWeight: "600", color: "#17231f", textAlign: "center" },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  ghostBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 },
  ghostText: { color: "#3d4f49", fontWeight: "600" },
  primaryBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#cbd6d1",
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    color: "#17231f",
  },
});
