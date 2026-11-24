import {useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import { Alert } from "../../lib/alert";
import {colors,font,spacing} from "../../lib/theme";
import {Button,Card,IconTile,SectionHeader} from "../../lib/ui";
import {getReviewCards,generateReviewCards,reviewCard,getPlanner,createPlannerTask,completePlannerTask} from "../../lib/api";

export default function Review(){
 const[cards,setCards]=useState<any[]>([]),[tasks,setTasks]=useState<any[]>([]),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 // กันดับเบิลคลิกงานในแผน: ถ้ากดซ้ำระหว่างบันทึก จะยิง PATCH สองครั้งแล้วติ๊กกลับเป็นไม่เสร็จ
 const taskLock=useRef(false);
 async function load(){setLoading(true);try{const[c,t]=await Promise.all([getReviewCards(),getPlanner()]);setCards(c);setTasks(t)}catch(e){Alert.alert("โหลด Review ไม่สำเร็จ",String(e))}finally{setLoading(false)}}
 useEffect(()=>{load()},[]);
 async function generate(){setBusy(true);try{await generateReviewCards();await load()}catch(e){Alert.alert("สร้างบัตรไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 async function rate(n:number){if(!cards[0])return;setBusy(true);try{await reviewCard(cards[0].id,n);setShow(false);await load()}catch(e){Alert.alert("บันทึกผลไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 async function addTask(){setBusy(true);try{await createPlannerTask({title:"ทบทวนบทเรียนวันนี้",durationMin:25});await load()}catch(e){Alert.alert("เพิ่มแผนไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 /** ติ๊ก/ยกเลิกงานในแผน — ล็อกไว้กันการกดซ้ำเร็ว ๆ แล้วสถานะเด้งกลับ */
 async function toggleTask(t:any){if(taskLock.current)return;taskLock.current=true;try{await completePlannerTask(t.id,!t.completed);await load()}catch(e){Alert.alert("อัปเดตแผนไม่สำเร็จ",String(e))}finally{taskLock.current=false}}
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
  <View style={styles.header}><View><Text style={styles.mini}>YOUR ROUTINE</Text><Text style={font.h1}>Review</Text></View><IconTile icon="repeat" color="#34d399" size={50}/></View>
  <View style={styles.stats}><Card style={styles.stat}><Text style={styles.big}>{loading?"…":cards.length}</Text><Text style={font.caption}>Cards due</Text></Card><Card style={styles.stat}><Text style={styles.big}>{loading?"…":tasks.filter(x=>!x.completed).length}</Text><Text style={font.caption}>Tasks</Text></Card></View>
  <SectionHeader title="Spaced Repetition" />
  {loading?<Card style={{alignItems:"center",paddingVertical:24}}><ActivityIndicator color={colors.accent}/><Text style={[font.caption,{marginTop:10}]}>กำลังโหลดบัตรทบทวน...</Text></Card>:cards[0]?<Card style={styles.flash}><Text style={styles.deck}>TODAY'S CARD</Text><Text style={font.h2}>{cards[0].prompt}</Text>{show?<><View style={styles.answer}><Text style={font.body}>{cards[0].answer}</Text></View><Text style={font.caption}>ยากแค่ไหน?</Text><View style={styles.ratings}>{[1,2,3,4,5].map(n=><Pressable key={n} onPress={()=>rate(n)} style={styles.rating}><Text style={styles.ratingText}>{n}</Text></Pressable>)}</View></>:<Pressable onPress={()=>setShow(true)} style={styles.show}><Text style={styles.showText}>ดูคำตอบ</Text></Pressable>}</Card>:<Card><Text style={font.title}>ไม่มีบัตรที่ถึงกำหนด 🎉</Text><Text style={[font.body,{marginVertical:10}]}>สร้างบัตรจากเนื้อหาที่คุณเรียนไว้ได้เลย</Text><Button onPress={generate} loading={busy} icon="sparkles">สร้าง Review Cards</Button></Card>}
  <SectionHeader title="Study Planner" action="+ เพิ่ม" onAction={addTask}/>
  {loading?<Card style={{alignItems:"center",paddingVertical:18}}><ActivityIndicator color={colors.accent}/></Card>:tasks.slice(0,8).map(t=><Pressable key={t.id} onPress={()=>toggleTask(t)}><Card style={styles.task}><View style={styles.taskRow}><IconTile icon={t.completed?"checkmark-circle":"time-outline"} color={t.completed?"#34d399":"#38bdf8"} size={38}/><View style={{flex:1}}><Text style={[font.title,t.completed&&styles.done]}>{t.title}</Text><Text style={font.caption}>{t.durationMin} นาที{t.dueAt?" · "+new Date(t.dueAt).toLocaleString("th-TH"): ""}</Text></View></View></Card></Pressable>)}
  <Button onPress={addTask} loading={busy} variant="secondary" icon="add">เพิ่ม Session 25 นาที</Button>
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:760,alignSelf:"center",width:"100%"},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.xl},mini:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa",marginBottom:5},stats:{flexDirection:"row",gap:10,marginBottom:spacing.xl},stat:{flex:1},big:{fontSize:28,fontWeight:"900",color:colors.text},flash:{padding:20},deck:{fontSize:10,fontWeight:"900",letterSpacing:1.5,color:"#a78bfa",marginBottom:14},answer:{backgroundColor:colors.surfaceAlt,padding:14,borderRadius:14,marginVertical:14},show:{marginTop:20,borderRadius:99,padding:13,backgroundColor:colors.accent,alignItems:"center"},showText:{color:"#fff",fontWeight:"900"},ratings:{flexDirection:"row",gap:8,marginTop:10},rating:{width:42,height:42,borderRadius:21,backgroundColor:colors.surfaceAlt,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:colors.border},ratingText:{fontWeight:"900",color:colors.text},task:{marginBottom:8,padding:13},taskRow:{flexDirection:"row",alignItems:"center",gap:12},done:{textDecorationLine:"line-through",color:colors.textMuted}
});