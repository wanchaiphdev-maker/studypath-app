import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getClassroomCourses, getClassroomStatus, syncClassroom } from "../lib/api";
import { colors, font, radius, spacing } from "../lib/theme";
import { Card } from "../lib/ui";

type Course = { id: string; name: string; section?: string; description?: string };

export default function ClassroomScreen() {
  const [connected, setConnected] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const autoDone = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await getClassroomStatus();
      setConnected(!!status.connected);
      if (status.connected) setCourses(await getClassroomCourses());
      else setCourses([]);
    } catch (error) {
      setSyncMsg(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg("กำลังนำเข้ารายวิชาและเนื้อหาจาก Classroom...");
    try {
      const result = await syncClassroom([]);
      const changed = Number(result.imported || 0) + Number(result.updated || 0);
      setSyncMsg(changed
        ? `พร้อมเรียนแล้ว · เนื้อหาใหม่ ${result.imported || 0} · อัปเดต ${result.updated || 0}`
        : "ข้อมูลเป็นปัจจุบันแล้ว · ไม่มีเนื้อหาใหม่");
      await load();
    } catch (error) {
      const message = String(error);
      setSyncMsg(/กำลังซิงก์อยู่/.test(message)
        ? "กำลังนำเข้าข้อมูลหลังเข้าสู่ระบบ · รายวิชาจะปรากฏเมื่อซิงก์เสร็จ"
        : `ซิงก์ไม่สำเร็จ: ${message}`);
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Sync automatically when opening this screen too. OAuth starts the same sync
  // immediately after consent, so this is a safe catch-up if login happened offline.
  useEffect(() => {
    if (!connected || autoDone.current) return;
    autoDone.current = true;
    const timer = setTimeout(() => void sync(), 0);
    return () => clearTimeout(timer);
  }, [connected, sync]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Pressable style={styles.back} onPress={() => router.replace("/(tabs)")}>
      <Ionicons name="chevron-back" size={20} color={colors.text} /><Text style={font.caption}>กลับ</Text>
    </Pressable>
    <Text style={styles.eyebrow}>GOOGLE WORKSPACE</Text>
    <Text style={font.h1}>Google Classroom</Text>

    {!connected ? <Card style={styles.stateCard}>
      <Ionicons name="logo-google" size={25} color="#4285F4" />
      <View style={{ flex: 1 }}>
        <Text style={font.title}>ยังไม่ได้เชื่อม Classroom</Text>
        <Text style={font.caption}>ออกจากระบบแล้วเข้าสู่ระบบด้วย Google เพื่อให้แอปนำเข้ารายวิชาและเนื้อหาให้อัตโนมัติ</Text>
      </View>
    </Card> : <>
      <Card style={styles.stateCard}>
        <Ionicons name="checkmark-circle" size={23} color="#34d399" />
        <View style={{ flex: 1 }}>
          <Text style={font.title}>เชื่อมต่อและซิงก์อัตโนมัติ</Text>
          <Text style={font.caption}>{syncMsg || "กำลังตรวจสอบเนื้อหาในรายวิชา..."}</Text>
        </View>
        {syncing ? <ActivityIndicator color="#a78bfa" /> : null}
      </Card>

      <View style={styles.sectionHead}>
        <Text style={font.h2}>รายวิชาใน Classroom</Text>
        <Text style={font.caption}>{courses.length} วิชา</Text>
      </View>
      {courses.length ? courses.map((course) => <Card key={course.id} style={styles.course}>
        <View style={styles.courseIcon}><Ionicons name="school-outline" size={21} color="#a78bfa" /></View>
        <View style={{ flex: 1 }}>
          <Text style={font.title}>{course.name}</Text>
          {!!course.section && <Text style={font.caption}>{course.section}</Text>}
        </View>
        <Ionicons name="checkmark-circle" size={20} color="#34d399" />
      </Card>) : <Card><Text style={font.caption}>ไม่พบรายวิชาที่กำลังใช้งานในบัญชี Google นี้</Text></Card>}

      <Text style={styles.filterNote}>นำเข้าเฉพาะเนื้อหาการเรียน · ตัดข้อความลาและเช็คชื่อออก</Text>
      <Pressable style={[styles.primary, syncing && { opacity: 0.65 }]} disabled={syncing} onPress={() => void sync()}>
        {syncing ? <ActivityIndicator color="#fff" /> : <Ionicons name="refresh-outline" size={19} color="#fff" />}
        <Text style={styles.primaryText}>{syncing ? "กำลังอัปเดตเนื้อหา..." : "อัปเดตเนื้อหาตอนนี้"}</Text>
      </Pressable>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 80, maxWidth: 760, alignSelf: "center", width: "100%", gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  eyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.6, color: "#a78bfa" },
  stateCard: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 8 },
  sectionHead: { marginTop: 14, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  course: { flexDirection: "row", alignItems: "center", gap: 11 },
  courseIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#7c3aed22", alignItems: "center", justifyContent: "center" },
  filterNote: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginTop: 5 },
  primary: { marginTop: 8, minHeight: 50, borderRadius: radius.md, backgroundColor: "#7c3aed", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 16 },
  primaryText: { color: "#fff", fontWeight: "900" },
});
