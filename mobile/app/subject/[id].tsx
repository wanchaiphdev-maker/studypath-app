import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { colors, font, radius, spacing } from "../../lib/theme";
import { Card, Button, SectionHeader } from "../../lib/ui";
import { askMaterial, createMaterial, generateQuiz, getSubject } from "../../lib/api";

export default function SubjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [subject, setSubject] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setSubject(await getSubject(String(id))); }
    catch (e) { Alert.alert("โหลดวิชาไม่สำเร็จ", String(e)); }
  }

  useEffect(() => { load(); }, [id]);

  async function addMaterial() {
    if (!text.trim()) return;
    setBusy(true);
    try { await createMaterial(String(id), title || "Lecture Note", text); setText(""); setTitle(""); await load(); }
    catch (e) { Alert.alert("เพิ่มเอกสารไม่สำเร็จ", String(e)); }
    finally { setBusy(false); }
  }

  async function ask() {
    const material = subject?.materials?.[0];
    if (!material || !question.trim()) { Alert.alert("AI Tutor", "เพิ่ม Material ก่อน แล้วจึงถามคำถาม"); return; }
    setBusy(true);
    try { setAnswer(await askMaterial(material.id, question)); }
    catch (e) { Alert.alert("AI Tutor", String(e)); }
    finally { setBusy(false); }
  }

  async function quiz() {
    setBusy(true);
    try { const q = await generateQuiz(String(id), 5); router.push(("/quiz/" + q.id) as any); }
    catch (e) { Alert.alert("สร้าง Quiz ไม่สำเร็จ", String(e)); }
    finally { setBusy(false); }
  }

  if (!subject) return <View style={styles.loading}><Text style={font.body}>กำลังโหลด...</Text></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Button variant="ghost" onPress={() => router.back()} icon="arrow-back">กลับ</Button>
      <Text style={font.h1}>{subject.name}</Text>
      <Text style={font.caption}>{subject.code || "Subject"}</Text>

      <Card style={styles.hero}>
        <Text style={font.caption}>MASTERY</Text>
        <Text style={styles.mastery}>{Math.round(subject.progress?.[0]?.mastery || 0)}%</Text>
        <Text style={font.body}>เอกสาร {subject.materials?.length || 0} รายการ</Text>
      </Card>

      <SectionHeader title="Add Learning Material" />
      <Card>
        <TextInput value={title} onChangeText={setTitle} placeholder="ชื่อเอกสาร" placeholderTextColor={colors.textMuted} style={styles.input} />
        <TextInput value={text} onChangeText={setText} multiline placeholder="วางเนื้อหา Lecture / Note ที่นี่..." placeholderTextColor={colors.textMuted} style={[styles.input, styles.textarea]} />
        <Button onPress={addMaterial} loading={busy} icon="cloud-upload-outline">บันทึกเข้า Knowledge Base</Button>
      </Card>

      <SectionHeader title="Materials" />
      {(subject.materials || []).map((m: any) => (
        <Card key={m.id} style={styles.material}>
          <Text style={font.title}>{m.title}</Text>
          <Text style={font.caption}>{m.status} · source: {m.sourceType}</Text>
        </Card>
      ))}

      <SectionHeader title="Grounded AI Tutor" />
      <Card>
        <TextInput value={question} onChangeText={setQuestion} multiline placeholder="ถามจากเอกสารของวิชานี้..." placeholderTextColor={colors.textMuted} style={[styles.input, styles.textarea]} />
        <Button onPress={ask} loading={busy} icon="sparkles-outline">ถาม AI จาก Material</Button>
        {answer && (
          <View style={styles.answer}>
            <Text style={font.title}>{answer.grounded ? "อ้างอิงจาก Knowledge Base" : "ไม่พบ Source"}</Text>
            <Text style={font.body}>{answer.answer}</Text>
            {answer.sources?.map((s: any) => <Text key={s.chunk} style={styles.source}>Source · {s.title} · chunk {s.chunk}</Text>)}
          </View>
        )}
      </Card>

      <Button onPress={quiz} loading={busy} icon="help-circle-outline">สร้าง Quiz 5 ข้อ</Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 50, gap: spacing.md },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  hero: { marginTop: spacing.md },
  mastery: { fontSize: 40, fontWeight: "800", color: colors.accent, marginVertical: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md, color: colors.text, marginBottom: spacing.sm },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  material: { padding: spacing.md },
  answer: { marginTop: spacing.md, gap: spacing.sm },
  source: { fontSize: 12, color: colors.accent, fontWeight: "600" },
});
