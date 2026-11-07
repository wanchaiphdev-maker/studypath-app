/**
 * ระบบแจ้งเตือนที่ใช้งานได้จริง
 *
 * ทำไมต้องมี: react-native-web ทำ Alert.alert เป็น no-op
 *   class Alert { static alert() {} }
 *   → ทุกข้อความ "บันทึกแล้ว" / "เกิดข้อผิดพลาด" บนเว็บจะไม่มีอะไรขึ้นจอเลย
 *   ผู้ใช้กดปุ่มแล้วไม่รู้ว่าสำเร็จหรือล้มเหลว
 *
 * ตัวนี้ใช้ Modal ของ RN จึงใช้ได้ทั้งเว็บและมือถือ
 */
import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font } from "./theme";

type Item = { title: string; message?: string; tone: "info" | "error" | "success" };

let emit: (i: Item) => void = () => {};
let close: () => void = () => {};

const TONE = {
  info: { icon: "information-circle" as const, color: "#2563eb", bg: "#eff6ff" },
  error: { icon: "alert-circle" as const, color: "#dc2626", bg: "#fef2f2" },
  success: { icon: "checkmark-circle" as const, color: "#059669", bg: "#ecfdf5" },
};

const ERR = /(error|failed|ไม่สำเร็จ|ผิดพลาด|ล้มเหลว|ไม่ได้|ยังไม่|ต้อง|ก่อน|invalid|unauthorized|not found|404|401|403|429|500)/i;
const OK = /(สำเร็จ|เรียบร้อย|พร้อม|success|เสร็จ|บันทึกแล้ว|อัปโหลดแล้ว|นำเข้าแล้ว)/i;

/** ข้อความแบบเดียวกับ Alert.alert ของ RN — เรียกแทนที่ได้เลย */
export const Alert = {
  alert(title: string, message?: string, ..._rest: any[]) {
    const raw = String(message ?? "");
    const tone: Item["tone"] =
      ERR.test(title) || ERR.test(raw) ? "error"
        : OK.test(title) || OK.test(raw) ? "success"
          : "info";
    emit({ title: String(title), message: raw || undefined, tone });
  },
};

/** ต้องวางไว้ที่ root layout เพียงครั้งเดียว */
export function AlertHost() {
  const [item, setItem] = useState<Item | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    emit = (i: Item) => {
      if (timer.current) clearTimeout(timer.current);
      setItem(i);
    };
    close = () => setItem(null);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  if (!item) return null;
  const t = TONE[item.tone];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setItem(null)}>
      <Pressable style={styles.backdrop} onPress={() => setItem(null)}>
        <Pressable style={styles.box} onPress={(e: any) => e.stopPropagation?.()}>
          <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
            <Ionicons name={t.icon} size={26} color={t.color} />
          </View>
          <Text style={[styles.title, { color: t.color }]}>{item.title}</Text>
          {item.message ? <Text style={styles.msg}>{item.message}</Text> : null}
          <Pressable style={[styles.ok, { backgroundColor: t.color }]} onPress={() => setItem(null)}>
            <Text style={styles.okText}>ตกลง</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(15,23,42,.55)", alignItems: "center",
    justifyContent: "center", padding: 24,
  },
  box: {
    width: "100%", maxWidth: 400, backgroundColor: "#fff", borderRadius: 20,
    padding: 22, alignItems: "center", gap: 8,
    shadowColor: "#0f172a", shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  iconWrap: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontSize: 17, fontWeight: "900", textAlign: "center" },
  msg: { ...font.body, color: colors.textSecondary, textAlign: "center", fontSize: 13.5, lineHeight: 20 },
  ok: { marginTop: 14, minWidth: 130, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  okText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});