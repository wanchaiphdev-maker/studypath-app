import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [status, subjectList] = await Promise.all([getClassroomStatus(), getSubjects()]);
      setConnected(!!status.connected);
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

  async function connect() {
    try {
      await Linking.openURL(buildGoogleAuthUrl("classroom"));
    } catch (e) {
      Alert.alert("เชื่อม Google Classroom", String(e));
    }
  }

  function cycleSubject(courseId: string) {
    if (!subjects.length) return;
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

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={20} color={colors.text} /><Text style={font.caption}>กลับ</Text></Pressable>
    <Text style={styles.eyebrow}>GOOGLE WORKSPACE</Text>
    <Text style={font.h1}>Google Classroom</Text>
    <Text style={font.caption}>ดึงสไลด์และเอกสารของแต่ละวิชาเข้า Knowledge Base ของ StudyPath แล้วให้ AI Tutor เรียนจากเนื้อหาจริง</Text>

    {!connected ? <Card style={styles.connectCard}>
      <View style={styles.googleIcon}><Ionicons name="logo-google" size={24} color="#fff" /></View>
      <Text style={font.h2}>เชื่อมบัญชี Google</Text>
      <Text style={font.caption}>StudyPath จะขอสิทธิ์อ่าน Classroom และไฟล์ Drive ที่ใช้กับการเรียน เพื่อซิงก์เนื้อหาเข้าวิชาของคุณ</Text>
      <Pressable style={styles.primary} onPress={connect}><Ionicons name="link-outline" size={18} color="#fff" /><Text style={styles.primaryText}>เชื่อม Google Classroom</Text></Pressable>
    </Card> : <>
      <Card style={styles.connected}>
        <Ionicons name="checkmark-circle" size={22} color="#34d399" />
        <View style={{ flex: 1 }}><Text style={font.title}>เชื่อมต่อแล้ว</Text><Text style={font.caption}>พร้อมซิงก์สื่อการเรียนจาก Classroom</Text></View>
        <Pressable onPress={connect}><Text style={styles.reconnect}>เชื่อมใหม่</Text></Pressable>
      </Card>

      <View style={styles.sectionHead}><Text style={font.h2}>จับคู่วิชา</Text><Text style={font.caption}>{courses.length} Classroom</Text></View>
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
          </Card>;
        })}
      <Pressable style={[styles.primary, syncing && { opacity: .6 }]} disabled={syncing} onPress={sync}>
        {syncing ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-download-outline" size={19} color="#fff" />}
        <Text style={styles.primaryText}>{syncing ? "กำลังนำเข้าเนื้อหา..." : "Sync เนื้อหาเข้า Knowledge Base"}</Text>
      </Pressable>
      <Card style={styles.note}><Ionicons name="sparkles-outline" size={19} color="#a78bfa" /><Text style={[font.caption,{flex:1}]}>หลัง Sync แล้ว สไลด์/เอกสารจะอยู่ในวิชาที่จับคู่ และ AI Tutor, Quiz, Review และ Knowledge Graph จะใช้ข้อมูลเหล่านั้นต่อได้</Text></Card>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:80,maxWidth:760,alignSelf:"center",width:"100%",gap:12},center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:colors.background},back:{flexDirection:"row",alignItems:"center",gap:4,marginBottom:6},eyebrow:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa"},connectCard:{padding:22,marginTop:8},googleIcon:{width:48,height:48,borderRadius:15,backgroundColor:"#4285F4",alignItems:"center",justifyContent:"center",marginBottom:14},primary:{marginTop:16,minHeight:50,borderRadius:radius.md,backgroundColor:"#7c3aed",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,paddingHorizontal:16},primaryText:{color:"#fff",fontWeight:"900"},connected:{flexDirection:"row",alignItems:"center",gap:11},reconnect:{fontSize:12,fontWeight:"900",color:"#a78bfa"},sectionHead:{marginTop:14,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between"},course:{flexDirection:"row",alignItems:"center",gap:11},courseIcon:{width:42,height:42,borderRadius:13,backgroundColor:"#7c3aed22",alignItems:"center",justifyContent:"center"},mapLabel:{fontSize:11,fontWeight:"800",color:"#a78bfa",marginTop:6},cycle:{width:40,height:40,borderRadius:13,backgroundColor:colors.surfaceAlt,alignItems:"center",justifyContent:"center"},note:{marginTop:2,flexDirection:"row",gap:9,alignItems:"flex-start"}
});
