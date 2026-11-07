import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Alert } from "../../lib/alert";
import { useLocalSearchParams, router } from "expo-router";
import { colors, font, radius, spacing } from "../../lib/theme";
import { Button, Card } from "../../lib/ui";
import { api, submitQuiz } from "../../lib/api";

/** รวมตัวเลือกที่ซ้ำกันให้เหลือตัวเดียว — กันไม่ให้ผู้สอบเห็นตัวเลือกเดิมสองครั้ง */
function uniqueOptions(options: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(options) ? options : []) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ").replace(/\s*([,;:])\s*/g, "$1").replace(/[.,;:!?)\]]+$/g, "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [quiz, setQuiz] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    api<any>("/studypath/quizzes/" + id)
      .then(setQuiz)
      .catch((e) => Alert.alert("โหลด Quiz ไม่สำเร็จ", String(e)));
  }, [id]);

  async function finish() {
    try {
      const data = await submitQuiz(
        String(id),
        Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }))
      );
      setResult(data);
    } catch (e) {
      Alert.alert("ส่งคำตอบไม่สำเร็จ", String(e));
    }
  }

  if (!quiz) return <View style={styles.loading}><Text>กำลังเตรียมข้อสอบ...</Text></View>;

  if (result) {
    return (
      <View style={styles.result}>
        <Text style={font.h1}>ผลการฝึก</Text>
        <Text style={styles.score}>{result.score}%</Text>
        <Text style={font.body}>ถูก {result.correct} / {result.total} ข้อ</Text>
        <Text style={font.body}>Mastery ใหม่ {result.mastery}%</Text>
        <Button onPress={() => (router.canGoBack?.() ? router.back() : router.replace("/(tabs)"))} icon="arrow-back">กลับวิชา</Button>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Button onPress={() => (router.canGoBack?.() ? router.back() : router.replace("/(tabs)/subjects"))} variant="secondary" icon="arrow-back">ออกจากข้อสอบ</Button>
      <Text style={font.h1}>{quiz.title}</Text>
      <Text style={font.caption}>Practice Mode · แสดงผลหลังส่งเท่านั้น</Text>
      {quiz.questions.map((q: any, index: number) => (
        <Card key={q.id} style={styles.question}>
          <Text style={font.title}>{index + 1}. {q.prompt}</Text>
          {uniqueOptions(q.options).map((option: string, oi: number) => (
            <Pressable
              key={q.id + ":" + oi}
              onPress={() => setAnswers((a) => ({ ...a, [q.id]: option }))}
              style={[styles.option, answers[q.id] === option && styles.selected]}
            >
              <Text style={font.body}>{option}</Text>
            </Pressable>
          ))}
        </Card>
      ))}
      <Text style={font.caption}>ตอบแล้ว {Object.keys(answers).length} / {quiz.questions.length} ข้อ</Text>
      <Button onPress={finish} disabled={Object.keys(answers).length === 0} icon="checkmark-circle-outline">ส่งคำตอบ</Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 50, gap: spacing.md },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  question: { gap: spacing.md },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
  selected: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  result: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  score: { fontSize: 64, fontWeight: "800", color: colors.accent },
});
