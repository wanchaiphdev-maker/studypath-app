import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, font, spacing } from "../../lib/theme";
import { Card, SectionHeader } from "../../lib/ui";
import { getProgress, logStudySession } from "../../lib/api";

export default function Review() {
  const [data, setData] = useState<any>({ progress: [], attempts: [] });

  useEffect(() => {
    getProgress().then(setData).catch(() => undefined);
  }, []);

  async function focus() {
    try {
      await logStudySession(25, data.progress?.[0]?.subjectId, "Review weakest subject");
      Alert.alert("บันทึกแล้ว", "เพิ่ม Focus Session 25 นาทีให้ Learning History แล้ว");
    } catch (e) {
      Alert.alert("บันทึกไม่สำเร็จ", String(e));
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={font.h1}>Review & Focus</Text>
      <Text style={font.caption}>ทบทวนสิ่งที่ยังไม่แม่น และสะสม Learning History</Text>
      <SectionHeader title="Review Priority" />
      {data.progress?.map((p: any) => (
        <Card key={p.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={font.title}>{p.subject?.name}</Text>
            <Text style={styles.mastery}>{Math.round(p.mastery)}%</Text>
          </View>
          <Text style={font.caption}>Study time {p.studyMins || 0} นาที · ยิ่งต่ำยิ่งควรทบทวน</Text>
        </Card>
      ))}
      {!data.progress?.length && (
        <Card>
          <Text style={font.body}>ยังไม่มีข้อมูล Review — ทำ Quiz อย่างน้อย 1 ครั้งก่อน</Text>
        </Card>
      )}
      <Card>
        <Text style={font.title}>Deep Work</Text>
        <Text style={font.body}>เริ่ม Focus Session 25 นาทีเพื่อบันทึกเวลาเรียนจริง</Text>
        <Text onPress={focus} style={styles.start}>เริ่ม 25 นาที</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between" },
  mastery: { fontWeight: "800", color: colors.accent },
  start: { marginTop: 12, fontWeight: "700", color: colors.accent },
});
