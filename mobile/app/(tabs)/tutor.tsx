import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { colors, font, spacing } from "../../lib/theme";
import { Card, Button } from "../../lib/ui";
import { askMaterial, getSubjects } from "../../lib/api";

export default function Tutor() {
  const [subjects,setSubjects]=useState<any[]>([]); const [question,setQuestion]=useState(""); const [answer,setAnswer]=useState<any>(null); const [busy,setBusy]=useState(false);
  useEffect(()=>{getSubjects().then(setSubjects).catch(()=>undefined)},[]);
  async function ask(){const material=subjects[0]?.materials?.[0]; if(!material){Alert.alert("AI Tutor","เปิดวิชาแล้วเพิ่ม Material ก่อน");return;}setBusy(true);try{setAnswer(await askMaterial(material.id,question))}catch(e){Alert.alert("AI Tutor",String(e))}finally{setBusy(false)}}
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><Text style={font.h1}>AI Tutor</Text><Text style={font.caption}>Grounded Learning · ตอบจาก Material เมื่อมี Source</Text><Card><TextInput value={question} onChangeText={setQuestion} multiline placeholder="เช่น อธิบายหัวข้อนี้แบบง่าย" placeholderTextColor={colors.textMuted} style={styles.input}/><Button onPress={ask} loading={busy} icon="sparkles-outline">ถาม AI</Button>{answer&&<Card style={styles.answer}><Text style={font.title}>{answer.grounded?"มี Source":"ไม่มี Source ใน Knowledge Base"}</Text><Text style={font.body}>{answer.answer}</Text></Card>}</Card><Text style={font.caption}>วิชาที่มีในระบบ: {subjects.length}</Text></ScrollView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,gap:spacing.md},input:{minHeight:130,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12,color:colors.text,textAlignVertical:"top",marginBottom:12},answer:{marginTop:12},});
