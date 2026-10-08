import {useEffect,useState} from "react";
import {Alert,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import {router} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {colors,font,radius,shadow,spacing} from "../../lib/theme";
import {Avatar,Card,GlowCard,IconTile,ProgressBar,SectionHeader,StatCard} from "../../lib/ui";
import {getProgress,getSubjects,api} from "../../lib/api";

export default function Dashboard(){
 const[name,setName]=useState("นักศึกษา"); const[subjects,setSubjects]=useState<any[]>([]); const[progress,setProgress]=useState<any[]>([]);
 useEffect(()=>{Promise.all([getSubjects().then(setSubjects),getProgress().then(x=>setProgress(x.progress||[])),api<any>("/me").then(x=>setName(x.name||"นักศึกษา"))]).catch(e=>Alert.alert("โหลดข้อมูลไม่สำเร็จ",String(e)))},[]);
 const avg=progress.length?Math.round(progress.reduce((a,x)=>a+Number(x.mastery||0),0)/progress.length):0;
 const first=subjects[0]; const firstProgress=progress.find(x=>x.subjectId===first?.id)?.mastery||0;
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
  <View style={styles.top}><View><Text style={styles.mini}>STUDYPATH • TODAY</Text><Text style={font.h1}>สวัสดี {name.split(" ")[0]} 👋</Text><Text style={font.body}>พร้อมเรียนต่อจากจุดที่ค้างไว้ไหม?</Text></View><Avatar name={name} size={48}/></View>
  <GlowCard style={styles.hero}><View style={styles.heroTop}><View><Text style={styles.heroEyebrow}>AI LEARNING OS</Text><Text style={styles.heroTitle}>เรียนให้เข้าใจ{"\n"}ไม่ใช่แค่จำ</Text></View><IconTile icon="sparkles" color="#fff" size={46}/></View><Text style={styles.heroText}>รวมสไลด์ เสียงบรรยาย Quiz และ AI Tutor ไว้ในที่เดียว</Text><Pressable onPress={()=>router.push(first?("/subject/"+first.id) as any:"/(tabs)/subjects" as any)} style={styles.heroButton}><Text style={styles.heroButtonText}>{first?"เรียนต่อ":"เริ่มเพิ่มวิชา"}</Text><Ionicons name="arrow-forward" size={17} color={colors.accent}/></Pressable></GlowCard>
  <View style={styles.stats}><StatCard value={String(subjects.length)} label="วิชาของฉัน" icon="library-outline"/><StatCard value={avg+"%"} label="Mastery เฉลี่ย" icon="analytics-outline" color="#38bdf8"/><StatCard value={String(progress.filter(x=>Number(x.mastery)>=80).length)} label="Mastered" icon="trophy-outline" color="#f59e0b"/></View>
  <SectionHeader title="เรียนต่อจากล่าสุด" action="ดูทั้งหมด" onAction={()=>router.push("/(tabs)/subjects" as any)}/>
  {first?<Card style={styles.course}><View style={styles.courseRow}><IconTile icon="server-outline" color={colors.accent}/><View style={styles.courseInfo}><Text style={font.title}>{first.code?first.code+" · ":""}{first.name}</Text><Text style={font.caption}>{first._count?.materials||0} Materials · กำลังเรียน</Text></View><Text style={styles.coursePct}>{Math.round(firstProgress)}%</Text></View><ProgressBar value={Number(firstProgress)}/><Pressable onPress={()=>router.push(("/subject/"+first.id) as any)}><Text style={styles.courseLink}>เปิดวิชา →</Text></Pressable></Card>:<Card><Text style={font.body}>ยังไม่มีวิชา เพิ่มวิชาแรกเพื่อเริ่มเส้นทางการเรียนรู้</Text></Card>}
  <SectionHeader title="ทำอะไรต่อดี?" />
  <View style={styles.actions}>{[
   ["sparkles-outline","ถาม AI","/(tabs)/tutor","#a855f7"],["cloud-upload-outline","เพิ่มเนื้อหา",first?("/subject/"+first.id):"/(tabs)/subjects","#38bdf8"],
   ["refresh-outline","ทบทวน","/(tabs)/review","#34d399"],["people-outline","Community","/community","#f59e0b"]
  ].map(([icon,label,path,c],i)=><Pressable key={i} onPress={()=>router.push(path as any)} style={styles.action}><IconTile icon={icon as any} color={c}/><Text style={styles.actionText}>{label}</Text></Pressable>)}</View>
  <SectionHeader title="ภาพรวมการเรียน" />
  {progress.slice(0,3).map(item=><Card key={item.id} style={styles.progress}><View style={styles.progressRow}><Text style={font.title}>{item.subject?.name||"วิชา"}</Text><Text style={styles.pct}>{Math.round(item.mastery||0)}%</Text></View><ProgressBar value={Number(item.mastery||0)}/></Card>)}
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:900,alignSelf:"center",width:"100%"},
 top:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.xl},mini:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa",marginBottom:5},
 hero:{marginBottom:spacing.lg,...shadow.raised},heroTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start"},heroEyebrow:{fontSize:10,fontWeight:"900",letterSpacing:1.8,color:"#ddd6fe"},heroTitle:{fontSize:27,fontWeight:"900",lineHeight:31,color:"#fff",marginTop:6},heroText:{color:"#e8e7ff",fontSize:13,lineHeight:20,marginTop:15,maxWidth:420},heroButton:{alignSelf:"flex-start",marginTop:18,paddingHorizontal:16,paddingVertical:10,borderRadius:99,backgroundColor:"#fff",flexDirection:"row",alignItems:"center",gap:8},heroButtonText:{color:colors.accent,fontWeight:"900",fontSize:13},
 stats:{flexDirection:"row",gap:8,marginBottom:spacing.xl},course:{marginBottom:spacing.xl},courseRow:{flexDirection:"row",alignItems:"center",gap:12},courseInfo:{flex:1},coursePct:{fontSize:18,fontWeight:"900",color:colors.accent},courseLink:{color:"#a78bfa",fontWeight:"800",fontSize:12,marginTop:10},
 actions:{flexDirection:"row",flexWrap:"wrap",gap:10,marginBottom:spacing.xl},action:{width:"23%",minWidth:120,backgroundColor:colors.surface,borderRadius:radius.lg,borderWidth:1,borderColor:colors.border,padding:14,gap:9,...shadow.card},actionText:{fontSize:12,fontWeight:"800",color:colors.text},progress:{marginBottom:8,padding:14},progressRow:{flexDirection:"row",justifyContent:"space-between",marginBottom:8},pct:{color:colors.accent,fontWeight:"900",fontSize:13}
});