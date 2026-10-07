import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "../../lib/theme";
import { Card, Button, SectionHeader } from "../../lib/ui";
import { createSemester, createSubject, createYear, getCurriculum, getSubjects } from "../../lib/api";

export default function SubjectsScreen() {
  const [years, setYears] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [yearName, setYearName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setYears(await getCurriculum()); setSubjects(await getSubjects()); } catch (e) { Alert.alert("โหลดข้อมูลไม่สำเร็จ", String(e)); }
  }
  useEffect(() => { load(); }, []);

  async function addYear() {
    if (!yearName.trim()) return;
    setBusy(true);
    try {
      const year = await createYear(yearName.trim());
      await createSemester(year.id, "ภาคเรียนที่ 1");
      setYearName(""); await load();
    } catch (e) { Alert.alert("เพิ่มปีการศึกษาไม่สำเร็จ", String(e)); } finally { setBusy(false); }
  }

  async function addSubject() {
    const semesterId = years[0]?.semesters?.[0]?.id;
    if (!semesterId || !subjectName.trim()) { Alert.alert("เพิ่มวิชา", "เพิ่มปีการศึกษาและภาคเรียนก่อน"); return; }
    setBusy(true);
    try { await createSubject(semesterId, subjectName.trim()); setSubjectName(""); await load(); }
    catch (e) { Alert.alert("เพิ่มวิชาไม่สำเร็จ", String(e)); } finally { setBusy(false); }
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.header}><View><Text style={font.h1}>วิชาของฉัน</Text><Text style={font.caption}>จัดโครงสร้างการเรียนให้เป็น Knowledge Base</Text></View><Ionicons name="school-outline" size={32} color={colors.accent} /></View>
    <Card style={styles.addCard}>
      <Text style={font.title}>เริ่ม Curriculum</Text>
      <TextInput value={yearName} onChangeText={setYearName} placeholder="เช่น ปี 1" placeholderTextColor={colors.textMuted} style={styles.input} />
      <Button onPress={addYear} loading={busy} icon="add-outline">เพิ่มปีการศึกษา + ภาคเรียน</Button>
    </Card>
    <Card style={styles.addCard}>
      <Text style={font.title}>เพิ่มวิชา</Text>
      <TextInput value={subjectName} onChangeText={setSubjectName} placeholder="เช่น Database Systems" placeholderTextColor={colors.textMuted} style={styles.input} />
      <Button onPress={addSubject} loading={busy} icon="book-outline">สร้างวิชา</Button>
    </Card>
    <SectionHeader title="วิชาทั้งหมด" />
    {subjects.map((subject) => <Pressable key={subject.id} onPress={() => router.push(("/subject/" + subject.id) as any)}>
      <Card style={styles.subjectCard}><View style={[styles.dot, { backgroundColor: subject.color || colors.accent }]} /><View style={styles.info}><Text style={font.title}>{subject.code ? subject.code + " · " : ""}{subject.name}</Text><Text style={font.caption}>{subject._count?.materials || 0} เอกสาร · Mastery {Math.round(subject.progress?.[0]?.mastery || 0)}%</Text></View><Ionicons name="chevron-forward" size={20} color={colors.textMuted} /></Card>
    </Pressable>)}
    {!subjects.length && <Text style={styles.empty}>ยังไม่มีวิชา — สร้างวิชาแรกเพื่อเริ่ม StudyPath</Text>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background}, content:{padding:spacing.lg,paddingBottom:40}, header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.lg}, addCard:{marginBottom:spacing.md}, input:{minHeight:48,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,backgroundColor:colors.surface,paddingHorizontal:spacing.md,color:colors.text,marginVertical:spacing.md}, subjectCard:{flexDirection:"row",alignItems:"center",gap:spacing.md,marginBottom:spacing.sm}, dot:{width:12,height:12,borderRadius:6},info:{flex:1},empty:{textAlign:"center",color:colors.textMuted,paddingVertical:40}
});
