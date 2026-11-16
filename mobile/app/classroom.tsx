import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Alert } from "../lib/alert";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { buildGoogleAuthUrl } from "../lib/googleAuth";
import { getClassroomCourses, getClassroomStatus, getSubjects, syncClassroom } from "../lib/api";
import { colors, font, radius, spacing } from "../lib/theme";
import { Card } from "../lib/ui";

type Course = { id: string; name: string; section?: string; description?: string };
type Subject = { id: string; name: string; code?: string | null };

export default function ClassroomScreen() {
  const [connected, setConnected] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const autoDone = useRef(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");

  /** router.back() จะไม่ทำงานถ้าเข้าหน้านี้ตรงๆ (ไม่มีประวัติ) — ต้องมีทางสำรอง */
  function goBack() {
    try {
      if (router.canGoBack?.()) { router.back(); return; }
    } catch { /* ใช้ทางสำรอง */ }
    router.replace("/(tabs)");
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [status, subjectList] = await Promise.all([getClassroomStatus(), getSubjects()]);
      setConnected(!!status.connected);
      setConnectedAt(status.connectedAt || null);
      setSubjects(subjectList);
      if (status.connected) {
        const list = await getClassroomCourses();
        setCourses(list);
        const next: Record<string, string> = {};
        for (const course of list) {
          const exact = subjectList.find((s: Subject) => s.name.trim().toLowerCase() === String(course.name).trim().toLowerCase());
          if (exact) next[course.id] = exact.id;
        }
        setMapping(next);
      }
    } catch (e) {
      Alert.alert("Google Classroom", String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ซิงก์อัตโนมัติทุกครั้งที่เปิดหน้านี้ (ทำงานเบื้องหลัง ไม่บล็อกหน้าจอ)
  // ต้องมี timeout เสมอ ไม่งั้นไฟล์ใหญ่ (วิดีโอ ~1GB) จะทำให้วงกลมหมุนค้างตลอดไป
  useEffect(() => {
    if (!connected || autoDone.current) return;
    autoDone.current = true;
    setAutoSyncing(true);
    setSyncMsg("กำลังเช็คไฟล์ใหม่ใน Classroom...");
    let cancelled = false;

    const timer = setTimeout(() => {
      if (!cancelled) setSyncMsg("ซิงก์ใช้เวลานาน (ไฟล์ใหญ่) — ปิดหน้านี้ไปก่อนได้ ระบบซิงก์อัตโนมัติทุก 5 นาที");
    }, 8000);

    syncClassroom([])
      .then((r) => {
        const total = (r.imported || 0) + (r.updated || 0);
        setSyncMsg(total > 0 ? `อัปเดตแล้ว · ใหม่ ${r.imported} · แก้ไข ${r.updated}` : "อยู่ต่อเนื่อง · ไม่มีไฟล์ใหม่");
        return total > 0 ? load() : undefined;
      })
      .catch(() => setSyncMsg("ซิงก์รอบนี้ไม่สำเร็จ — ระบบจะลองใหม่อัตโนมัติ"))
      .finally(() => { clearTimeout(timer); if (!cancelled) setAutoSyncing(false); });

    return () => { cancelled = true; clearTimeout(timer); };
  }, [connected, load]);

  async function connect() {
    try {
      const url = buildGoogleAuthUrl("classroom");
      if (typeof window !== "undefined") {
        window.location.assign(url);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("เชื่อม Google Classroom ไม่สำเร็จ", String(e));
    }
  }

  function cycleSubject(courseId: string) {
    if (!subjects.length) {
      Alert.alert("ยังไม่มีวิชา", "ไปที่แท็บ \"วิชา\" เพื่อสร้างวิชาและภาคเรียนก่อน แล้วกลับมาจับคู่อีกครั้ง");
      return;
    }
    const current = mapping[courseId];
    const index = Math.max(0, subjects.findIndex((s) => s.id === current));
    const next = subjects[(index + 1) % subjects.length];
    setMapping((old) => ({ ...old, [courseId]: next.id }));
  }

  async function sync() {
    const mappings = courses.filter((c) => mapping[c.id]).map((c) => ({ courseId: c.id, subjectId: mapping[c.id] }));
    if (!mappings.length) {
      Alert.alert("ยังไม่ได้จับคู่วิชา", "เลือกวิชา StudyPath ให้ Classroom อย่างน้อย 1 วิชาก่อน");
      return;
    }
    setSyncing(true);
    try {
      const result = await syncClassroom(mappings);
      Alert.alert("Sync สำเร็จ", `นำเข้าใหม่ ${result.imported} รายการ · อัปเดต ${result.updated} · ข้าม ${result.skipped} · ไม่รองรับ ${result.unsupported}`);
      await load();
    } catch (e) {
      Alert.alert("Sync ไม่สำเร็จ", String(e));
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;

  const matched = courses.filter((c) => mapping[c.id]).length;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Pressable style={styles.back} onPress={() => goBack()}><Ionicons name="chevron-back" size={20} color={colors.text} /><Text style={font.caption}>กลับ</Text></Pressable>
    <Text style={styles.eyebrow}>GOOGLE WORKSPACE</Text>
    <Text style={font.h1}>Google Classroom</Text>

    {!connected ? <Card style={styles.connectCard}>
      <View style={styles.googleIcon}><Ionicons name="logo-google" size={24} color="#fff" /></View>
      <Text style={font.h2}>เชื่อมบัญชี Google</Text>
      <Pressable style={styles.primary} onPress={connect}><Ionicons name="link-outline" size={18} color="#fff" /><Text style={styles.primaryText}>เชื่อม Google Classroom</Text></Pressable>
    </Card> : <>
      <Card style={styles.connected}>
        <Ionicons name="checkmark-circle" size={22} color="#34d399" />
        <View style={{ flex: 1 }}>
          <Text style={font.title}>เชื่อมต่อ Google แล้ว</Text>
          <Text style={font.caption}>
            {autoSyncing
              ? (syncMsg || "กำลังอัปเดตอัตโนมัติ...")
              : (syncMsg || "อัปเดตอัตโนมัติทุก 5 นาที")}
          </Text>
          {connectedAt ? <Text style={[font.caption, { marginTop: 2 }]}>เชื่อมเมื่อ {new Date(connectedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</Text> : null}
        </View>
        {autoSyncing ? <ActivityIndicator color="#a78bfa" /> : null}
        <Pressable onPress={connect} style={styles.reconnectBtn}>
          <Ionicons name="refresh-outline" size={13} color="#a78bfa" />
          <Text style={styles.reconnect}>เชื่อมใหม่</Text>
        </Pressable>
      </Card>

      {subjects.length === 0 ? <Card style={styles.warn}>
        <Ionicons name="alert-circle-outline" size={20} color="#f59e0b" />
        <Text style={[font.caption, { flex: 1 }]}>ยังไม่มีวิชาใน StudyPath — ไปที่แท็บ <Text style={{ fontWeight: "900" }}>วิชา</Text> แล้วสร้างปีการศึกษา ภาคเรียน และวิชาอย่างน้อย 1 วิชา จึงจะจับคู่และซิงก์เนื้อหาได้</Text>
      </Card> : null}

      <View style={styles.sectionHead}><Text style={font.h2}>จับคู่วิชา</Text><Text style={font.caption}>{courses.length} Classroom · จับคู่แล้ว {matched}</Text></View>
      {courses.length === 0 ? <Card><Text style={font.caption}>ไม่พบ Classroom ที่ใช้งานอยู่ หรือบัญชีนี้ยังไม่มีวิชาที่เข้าถึงได้</Text></Card> :
        courses.map((course) => {
          const subject = subjects.find((s) => s.id === mapping[course.id]);
          return <Card key={course.id} style={styles.course}>
            <View style={styles.courseIcon}><Ionicons name="school-outline" size={21} color="#a78bfa" /></View>
            <View style={{ flex: 1 }}>
              <Text style={font.title}>{course.name}</Text>
              {!!course.section && <Text style={font.caption}>{course.section}</Text>}
              <Text style={styles.mapLabel}>→ StudyPath: {subject ? subject.name : "ยังไม่ได้เลือกวิชา"}</Text>
            </View>
            <Pressable style={styles.cycle} onPress={() => cycleSubject(course.id)}><Ionicons name="swap-horizontal" size={18} color={colors.text} /></Pressable>
            {subject ? <Pressable style={styles.unmap} onPress={() => setMapping((old) => { const n = { ...old }; delete n[course.id]; return n; })} hitSlop={6}><Ionicons name="close-circle" size={19} color={colors.danger} /></Pressable> : null}
          </Card>;
        })}
      <Pressable style={[styles.primary, syncing && { opacity: .6 }]} disabled={syncing} onPress={sync}>
        {syncing ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-download-outline" size={19} color="#fff" />}
        <Text style={styles.primaryText}>{syncing ? "กำลังนำเข้าเนื้อหา..." : "Sync เนื้อหาเข้า Knowledge Base"}</Text>
      </Pressable>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:80,maxWidth:760,alignSelf:"center",width:"100%",gap:12},center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:colors.background},back:{flexDirection:"row",alignItems:"center",gap:4,marginBottom:6},eyebrow:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa"},connectCard:{padding:22,marginTop:8},googleIcon:{width:48,height:48,borderRadius:15,backgroundColor:"#4285F4",alignItems:"center",justifyContent:"center",marginBottom:14},primary:{marginTop:16,minHeight:50,borderRadius:radius.md,backgroundColor:"#7c3aed",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,paddingHorizontal:16},primaryText:{color:"#fff",fontWeight:"900"},connected:{flexDirection:"row",alignItems:"center",gap:11},warn:{flexDirection:"row",gap:9,alignItems:"flex-start",borderColor:"#f59e0b"},reconnect:{fontSize:12,fontWeight:"900",color:"#a78bfa"},reconnectBtn:{flexDirection:"row",alignItems:"center",gap:5,paddingHorizontal:11,paddingVertical:8,borderRadius:11,backgroundColor:"#a78bfa1f",borderWidth:1,borderColor:"#a78bfa55"},sectionHead:{marginTop:14,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between"},course:{flexDirection:"row",alignItems:"center",gap:11},courseIcon:{width:42,height:42,borderRadius:13,backgroundColor:"#7c3aed22",alignItems:"center",justifyContent:"center"},mapLabel:{fontSize:11,fontWeight:"800",color:"#a78bfa",marginTop:6},cycle:{width:40,height:40,borderRadius:13,backgroundColor:colors.surfaceAlt,alignItems:"center",justifyContent:"center"},unmap:{width:34,height:40,alignItems:"center",justifyContent:"center"},note:{marginTop:2,flexDirection:"row",gap:9,alignItems:"flex-start"}
});