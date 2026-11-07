import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card } from "../lib/ui";
import { colors, font, spacing } from "../lib/theme";

export type PickMaterial = {
  id: string;
  title: string;
  fileName?: string | null;
  mimeType?: string | null;
  textContent?: string | null;
  category?: string | null;
};

/** ป้ายหมวดตามที่ผู้ใช้กำหนด: โบนัส · งานในห้อง · การบ้าน · เช็คชื่อ · VDO · สไลด์ */
const CATEGORY_LABEL: Record<string, string> = {
  bonus: "โบนัส",
  inclass: "งานในห้อง",
  homework: "การบ้าน",
  checkin: "เช็คชื่อ",
  vdo: "VDO",
  slide: "สไลด์",
};
const CATEGORY_ORDER = ["การบ้าน", "งานในห้อง", "โบนัส", "สไลด์", "VDO", "เช็คชื่อ", "อื่น ๆ"];
const CATEGORY_ICON: Record<string, string> = {
  "การบ้าน": "create-outline",
  "งานในห้อง": "school-outline",
  "โบนัส": "star-outline",
  "สไลด์": "document-text-outline",
  "VDO": "play-circle-outline",
  "เช็คชื่อ": "checkmark-done-outline",
  "อื่น ๆ": "ellipse-outline",
};

function groupOf(m: PickMaterial): string {
  const c = String(m.category || "");
  if (c && CATEGORY_LABEL[c]) return CATEGORY_LABEL[c];
  const mt = String(m.mimeType || "");
  if (mt.startsWith("video/")) return "VDO";
  if (mt.startsWith("audio/")) return "VDO";
  return "อื่น ๆ";
}

/** นับตัวอักษรแบบไทยถูกต้อง — สระ/วรรณยุกต์อยู่ในกลุ่ม \p{M} ไม่ใช่ \p{L} */
function letterCount(text: string): number {
  return String(text || "").replace(/[^\p{L}\p{N}\p{M}]/gu, "").length;
}

/**
 * ประโยคที่เอาไปตั้งเป็นโจทย์เติมคำได้จริง
 * ต้องตรงกับ usableSentence() ฝั่งเซิร์ฟเวอร์ ไม่งั้นตัวเลขที่แสดงจะโกหกผู้ใช้
 */
function isUsableSentence(s: string): boolean {
  const letters = letterCount(s);
  if (letters < 20) return false;
  if (letters / s.length < 0.4) return false;                 // ตัวเลขเยอะ = ตาราง
  if ((s.match(/[+×÷=]/g) || []).length >= 3) return false;   // สมการยาวเกิน
  if (/^[\d\s.,+\-*/=%_$#|]+$/.test(s)) return false;          // ไม่มีตัวอักษรเลย
  return true;
}

/** จำนวนประโยคที่ยาวพอจะตั้งโจทย์เติมคำได้ — กรองเอกสารที่ไม่มีเนื้อหา */
function usableCount(m: PickMaterial): number {
  return String(m.textContent || "")
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 30 && isUsableSentence(x)).length;
}

/**
 * สไลด์รูปภาพ = PDF ที่ดึงข้อความไม่ได้ จะได้แต่ตัวเลขกับ page marker
 * สังเกตจาก "อัตราส่วนตัวอักษรต่อขนาดไฟล์" ไม่ใช่หา "-- N of M --"
 * (รูปแบบนั้นมีในทุกไฟล์ เพราะเป็น page marker ของตัวดึงข้อความ)
 */
function isImageSlide(m: PickMaterial): boolean {
  const t = String(m.textContent || "");
  if (t.length < 200) return false;
  // ต้องนับ \p{M} ด้วย สระ/วรรณยุกต์ไทยอยู่ในกลุ่ม Mark ไม่ใช่ Letter
  // ถ้านับแค่ \p{L} ไทยจะถูกนับต่ำเกินจริง ~30% แล้วเข้าใกล้เกณฑ์ผิด
  const letters = t.replace(/[^\p{L}\p{N}\p{M}]/gu, "").length;
  return letters / t.length < 0.30;   // เกณฑ์เดียวกับ MIN_RATIO ฝั่งเซิร์ฟเวอร์
}

/**
 * ให้ผู้ใช้เลือก "สไลด์/เอกสาร" ที่จะใช้สร้างข้อสอบก่อน
 * ถ้าไม่เลือกเลย ปุ่มหลักจะใช้ทั้งวิชา
 */
export default function QuizPickerModal({
  visible, materials, subjectName, busy, onClose, onConfirm,
}: {
  visible: boolean;
  materials: PickMaterial[];
  subjectName: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = materials
      .map((m) => ({ m, n: usableCount(m) }))
      .filter((r) => r.n > 0 || q.trim());
    // เรียงตามจำนวนประโยคที่ใช้ได้จริง ไฟล์ที่เนื้อหาเยอะขึ้นก่อน
    // (ไม่งั้นประกาศซึ่งมีประโยคนิดเดียวจะขึ้นมาก่อนสไลด์บทที่ 5)
    const sorted = [...list].sort((a, b) => b.n - a.n || a.m.title.localeCompare(b.m.title, "th"));
    if (!q.trim()) return sorted;
    const k = q.trim().toLowerCase();
    return sorted.filter((r) =>
      String(r.m.title + " " + (r.m.fileName || "")).toLowerCase().includes(k));
  }, [materials, q]);

  // เรียงกลุ่ม: การบ้าน/งานในห้อง/โบนัส (ที่จะเอาไปทำข้อสอบ) ขึ้นก่อน
  const grouped = useMemo(() => {
    const g: Record<string, (typeof rows)[number][]> = {};
    for (const r of rows) (g[groupOf(r.m)] = g[groupOf(r.m)] || []).push(r);
    return Object.entries(g).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a[0]);
      const ib = CATEGORY_ORDER.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      // กลุ่มที่รวมประโยคได้มากขึ้นขึ้นก่อน
      const sa = a[1].reduce((s, r) => s + r.n, 0);
      const sb = b[1].reduce((s, r) => s + r.n, 0);
      return sb - sa;
    });
  }, [rows]);

  // สไลด์รูปภาพ ยังไม่มี OCR — เตือนไม่ให้เลือกแล้วได้โจทย์เพี้ยน
  const blankPage = useMemo(() => materials.filter(isImageSlide), [materials]);

  const ids = (g: string) => rows.filter((r) => groupOf(r.m) === g).map((r) => r.m.id);
  const allGroupPicked = (g: string) => { const a = ids(g); return a.length > 0 && a.every((i) => picked.includes(i)); };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleGroup = (g: string) => {
    const a = ids(g);
    setPicked((p) => (allGroupPicked(g) ? p.filter((x) => !a.includes(x)) : [...new Set([...p, ...a])]));
  };
  const pickAll = () => setPicked(allGroupPicked("__all") ? [] : rows.map((r) => r.m.id));
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.m.id));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={font.h2}>เลือกสไลด์ที่จะใช้ทำข้อสอบ</Text>
              <Text style={font.caption} numberOfLines={1}>{subjectName}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          {blankPage.length > 0 ? (
            <View style={styles.warn}>
              <Ionicons name="alert-circle" size={16} color="#b45309" />
              <Text style={styles.warnText}>
                {blankPage.length} ไฟล์เป็นสไลด์รูปภาพ (เช่น “{blankPage[0].title}”) ยังดึงข้อความไม่ได้
                เลือกแล้วจะได้โจทย์จากไฟล์อื่นแทน — ถ้าต้องการ ให้เพิ่มไฟล์ PDF ที่เป็นข้อความจริง
              </Text>
            </View>
          ) : null}

          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={q} onChangeText={setQ} placeholder="ค้นาชื่อไฟล์…"
                placeholderTextColor={colors.textMuted} style={styles.searchInput}
              />
              {q ? (
                <Pressable onPress={() => setQ("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
            <Pressable style={styles.linkBtn} onPress={pickAll}>
              <Text style={styles.linkText}>{allPicked ? "ไม่เลือก" : "เลือกทั้งหมด"}</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 330 }} keyboardShouldPersistTaps="handled">
            {rows.length === 0 ? (
              <Card><Text style={font.caption}>ไม่พบไฟล์ที่มีเนื้อหาพอจะทำข้อสอบ</Text></Card>
            ) : grouped.map(([g, list]) => (
              <View key={g} style={{ marginBottom: 10 }}>
                <Pressable style={styles.groupHead} onPress={() => toggleGroup(g)}>
                  <Ionicons
                    name={(CATEGORY_ICON[g] as any) || "ellipse-outline"}
                    size={16} color={colors.accent}
                  />
                  <Ionicons
                    name={allGroupPicked(g) ? "checkbox" : "square-outline"}
                    size={17} color={colors.accent}
                  />
                  <Text style={styles.groupTitle}>{g}</Text>
                  <Text style={font.caption}>
                    {list.length} ไฟล์ · {list.reduce((s, r) => s + r.n, 0).toLocaleString()} ประโยค
                  </Text>
                </Pressable>
                {list.map((r) => {
                  const on = picked.includes(r.m.id);
                  const rich = r.n >= 50;    // เนื้อหาหนาแน่น = คุ้มค่าแก่การเลือก
                  return (
                    <Pressable key={r.m.id} style={styles.row} onPress={() => toggle(r.m.id)}>
                      <Ionicons
                        name={on ? "checkbox" : "square-outline"}
                        size={21} color={on ? colors.accent : colors.textMuted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, on && { color: colors.text }]} numberOfLines={2}>
                          {r.m.title}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                          {rich ? (
                            <View style={styles.tagGood}>
                              <Ionicons name="checkmark-circle" size={11} color="#047857" />
                              <Text style={styles.tagGoodText}>เนื้อหาเยอะ</Text>
                            </View>
                          ) : null}
                          <Text style={font.caption}>
                            {r.n >= 1 ? `ทำโจทย์ได้ ${r.n.toLocaleString()} ประโยค` : "เนื้อหาสั้นเกินไป"}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <View style={styles.foot}>
            <Pressable
              onPress={() => onConfirm(picked)}
              disabled={busy}
              style={[styles.confirm, busy && { opacity: 0.6 }]}
            >
              <Ionicons name="help-circle-outline" size={19} color="#fff" />
              <Text style={styles.confirmText}>
                {picked.length ? `สร้างจาก ${picked.length} ไฟล์ที่เลือก` : "สร้างจากทั้งวิชา"}
              </Text>
            </Pressable>
          </View>
          <Text style={[font.caption, { textAlign: "center", marginTop: 6 }]}>
            ไม่เลือก = ใช้ทุกไฟล์ในวิชานี้
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, paddingBottom: spacing.xl, gap: 10, maxHeight: "88%",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  search: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12,
    height: 42, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.text, paddingVertical: 0 },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  linkText: { fontSize: 12.5, fontWeight: "900", color: colors.accent },
  warn: {
    flexDirection: "row", gap: 8, padding: 10, borderRadius: 10,
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
  },
  tagGood: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#ecfdf5", borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: "#a7f3d0",
  },
  tagGoodText: { fontSize: 10, fontWeight: "800", color: "#047857" },
  warnText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: "#92400e" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  groupTitle: { flex: 1, fontSize: 11.5, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.4 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
    paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border, marginBottom: 6,
  },
  foot: { flexDirection: "row", gap: 10, marginTop: 4 },
  confirm: {
    flex: 1, height: 50, borderRadius: 14, backgroundColor: colors.accent,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  confirmText: { color: "#fff", fontSize: 14.5, fontWeight: "900" },
});