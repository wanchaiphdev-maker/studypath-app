import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, shadow, spacing } from "../../lib/theme";
import { Card, SectionHeader, StatCard } from "../../lib/ui";
import { getProgress, getSubjects, api } from "../../lib/api";

export default function Dashboard() {
  const [name, setName] = useState("นักศึกษา");
  const [subjects, setSubjects] = useState<any[]>([]);
  const [progress, setProgress] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      getSubjects().then(setSubjects),
      getProgress().then((data) => setProgress(data.progress || [])),
      api<any>("/me").then((me) => setName(me.name || "นักศึกษา")),
    ]).catch((e) => Alert.alert("โหลดข้อมูลไม่สำเร็จ", String(e)));
  }, []);

  const mastered = progress.filter((x) => Number(x.mastery) >= 80).length;
  const average = progress.length
    ? Math.round(progress.reduce((a, x) => a + Number(x.mastery || 0), 0) / progress.length)
    : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.greeting}>
        <View>
          <Text style={styles.eyebrow}>STUDYPATH</Text>
          <Text style={font.h1}>สวัสดี {name.split(" ")[0]}</Text>
          <Text style={font.caption}>วันนี้ควรเรียนอะไรต่อ?</Text>
        </View>
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={22} color="#fff" />
        </View>
      </View>

      <Card style={styles.next}>
        <View style={styles.nextIcon}>
          <Ionicons name="navigate-outline" size={22} color={colors.accent} />
        </View>
        <View style={styles.nextBody}>
          <Text style={font.caption}>NEXT LEARNING ACTION</Text>
          <Text style={font.h3}>{subjects[0]?.name || "เพิ่มวิชาแรกของคุณ"}</Text>
          <Text style={font.body}>
            {subjects.length
              ? "เพิ่ม Material แล้วใช้ AI Tutor หรือสร้าง Quiz"
              : "เริ่มจาก Curriculum → Subject → Material"}
          </Text>
        </View>
      </Card>

      <View style={styles.stats}>
        <StatCard label="วิชา" value={String(subjects.length)} color={colors.accent} />
        <StatCard label="Mastery เฉลี่ย" value={average + "%"} color={colors.accent} />
        <StatCard label="Mastered" value={String(mastered)} color={colors.accent} />
      </View>

      <SectionHeader title="Quick Actions" />
      <View style={styles.actions}>
        <Pressable onPress={() => router.push("/(tabs)/subjects" as any)} style={styles.action}>
          <Ionicons name="add-circle-outline" size={26} color={colors.accent} />
          <Text style={font.label}>เพิ่มวิชา</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/(tabs)/tutor" as any)} style={styles.action}>
          <Ionicons name="sparkles-outline" size={26} color={colors.accent} />
          <Text style={font.label}>ถาม AI</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/(tabs)/review" as any)} style={styles.action}>
          <Ionicons name="refresh-outline" size={26} color={colors.accent} />
          <Text style={font.label}>ทบทวน</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/community" as any)} style={styles.action}>
          <Ionicons name="people-outline" size={26} color={colors.accent} />
          <Text style={font.label}>Community</Text>
        </Pressable>
      </View>

      <SectionHeader title="Learning Progress" />
      {progress.map((item) => (
        <Card key={item.id} style={styles.progress}>
          <View style={styles.row}>
            <Text style={font.title}>{item.subject?.name}</Text>
            <Text style={styles.percent}>{Math.round(item.mastery)}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: (Math.max(2, Math.min(100, Number(item.mastery))) + "%") as any }]} />
          </View>
          <Text style={font.caption}>เวลาเรียน {item.studyMins || 0} นาที</Text>
        </Card>
      ))}
      {!progress.length && (
        <Card>
          <Text style={font.body}>Progress จะเริ่มสะสมเมื่อคุณทำ Quiz และบันทึก Study Session</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 40 },
  greeting: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 2, color: colors.accent, marginBottom: 4 },
  avatar: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", ...shadow.raised },
  next: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  nextIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  nextBody: { flex: 1, gap: 4 },
  stats: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xl },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xl },
  action: { flex: 1, minHeight: 88, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 8 },
  progress: { marginBottom: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  percent: { fontSize: 16, fontWeight: "800", color: colors.accent },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: "hidden", marginBottom: spacing.sm },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
