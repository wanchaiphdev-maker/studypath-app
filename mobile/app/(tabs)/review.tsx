import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, font, spacing } from "../../lib/theme";
import { Card, Button, SectionHeader } from "../../lib/ui";
import { getReviewCards, generateReviewCards, reviewCard, getPlanner, createPlannerTask, completePlannerTask } from "../../lib/api";

export default function Review() {
  const [cards, setCards] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  async function load() { try { const [c,t]=await Promise.all([getReviewCards(),getPlanner()]); setCards(c); setTasks(t); } catch(e){ Alert.alert("โหลด Review ไม่สำเร็จ",String(e)); } }
  useEffect(()=>{load();},[]);
  async function generate(){setBusy(true);try{await generateReviewCards();await load();Alert.alert("สร้างแล้ว","เพิ่มบัตรทบทวนจากเอกสารล่าสุดแล้ว");}catch(e){Alert.alert("สร้างบัตรไม่สำเร็จ",String(e));}finally{setBusy(false);}}
  async function rate(r:number){if(!cards[0])return;setBusy(true);try{await reviewCard(cards[0].id,r);setShowAnswer(false);await load();}catch(e){Alert.alert("บันทึกผลไม่สำเร็จ",String(e));}finally{setBusy(false);}}
  async function addTask(){setBusy(true);try{await createPlannerTask({title:"ทบทวนบทเรียนวันนี้",durationMin:25});await load();}catch(e){Alert.alert("เพิ่มแผนไม่สำเร็จ",String(e));}finally{setBusy(false);}}
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={font.h1}>Review & Planner</Text><Text style={font.caption}>Spaced Repetition + งานที่ต้องทำวันนี้</Text>
    <SectionHeader title="Due Review"/>
    {cards[0]?<Card><Text style={font.caption}>บัตร {cards.length} ใบที่ถึงกำหนด</Text><Text style={font.h3}>{cards[0].prompt}</Text>
      {showAnswer?<Text style={styles.answer}>{cards[0].answer}</Text>:<Pressable onPress={()=>setShowAnswer(true)}><Text style={styles.link}>แตะเพื่อดูคำตอบ</Text></Pressable>}
      {showAnswer?<View style={styles.ratings}>{[1,2,3,4,5].map(r=><Pressable key={r} disabled={busy} onPress={()=>rate(r)} style={styles.rating}><Text style={styles.ratingText}>{r}</Text></Pressable>)}</View>:null}</Card>
      :<Card><Text style={font.body}>ไม่มีบัตรที่ถึงกำหนด</Text><Button onPress={generate} loading={busy}>สร้างบัตรทบทวนจากเอกสาร</Button></Card>}
    <SectionHeader title="Study Planner"/>
    {tasks.slice(0,10).map(task=><Card key={task.id} style={styles.task}><Pressable onPress={async()=>{await completePlannerTask(task.id,!task.completed);await load();}}><Text style={[font.title,task.completed&&styles.done]}>{task.completed?"✓ ":"○ "}{task.title}</Text><Text style={font.caption}>{task.durationMin} นาที{task.dueAt?" · "+new Date(task.dueAt).toLocaleString("th-TH"):""}</Text></Pressable></Card>)}
    <Button onPress={addTask} loading={busy} variant="secondary">+ เพิ่มงานทบทวน 25 นาที</Button>
  </ScrollView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:50,gap:spacing.md},answer:{fontSize:22,fontWeight:"800",color:colors.accent,marginVertical:spacing.md},link:{color:colors.accent,fontWeight:"700",marginTop:spacing.md},ratings:{flexDirection:"row",gap:8,marginTop:spacing.md},rating:{width:40,height:40,borderRadius:20,backgroundColor:colors.surfaceAlt,alignItems:"center",justifyContent:"center"},ratingText:{fontWeight:"800",color:colors.accent},task:{padding:spacing.md},done:{textDecorationLine:"line-through",color:colors.textMuted}});
