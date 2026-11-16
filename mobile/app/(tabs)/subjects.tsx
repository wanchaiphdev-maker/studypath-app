import {useCallback,useState} from "react";
import {Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import { Alert } from "../../lib/alert";
import {router,useFocusEffect} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {colors,font,radius,spacing} from "../../lib/theme";
import {Button,Card,IconTile,Pill,ProgressBar,SectionHeader} from "../../lib/ui";
import {createSemester,createSubject,createYear,getCurriculum,getSubjects} from "../../lib/api";

export default function SubjectsScreen(){
 const[years,setYears]=useState<any[]>([]),[subjects,setSubjects]=useState<any[]>([]),[yearName,setYearName]=useState(""),[subjectName,setSubjectName]=useState(""),[q,setQ]=useState(""),[busy,setBusy]=useState(false);
 async function load(){try{setYears(await getCurriculum());setSubjects(await getSubjects())}catch(e){Alert.alert("โหลดข้อมูลไม่สำเร็จ",String(e))}}
 useFocusEffect(useCallback(()=>{void load()},[]));
 async function addYear(){if(!yearName.trim())return;setBusy(true);try{const y=await createYear(yearName.trim());await createSemester(y.id,"ภาคเรียนที่ 1");setYearName("");await load()}catch(e){Alert.alert("เพิ่มปีการศึกษาไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 async function addSubject(){const semesterId=years[0]?.semesters?.[0]?.id;if(!semesterId||!subjectName.trim()){Alert.alert("เพิ่มวิชา","สร้างปีการศึกษาและภาคเรียนก่อน");return}setBusy(true);try{await createSubject(semesterId,subjectName.trim());setSubjectName("");await load()}catch(e){Alert.alert("เพิ่มวิชาไม่สำเร็จ",String(e))}finally{setBusy(false)}}
  const filtered=subjects.filter(s=>{const k=q.trim().toLowerCase();if(!k)return true;return(`${s.code||""} ${s.name}`).toLowerCase().includes(k);});
  // จัดกลุ่มตามเทอม — เรียงตามปีการศึกษา -> ภาคเรียน (กลุ่มที่เข้ามาทีหลัง = เทอมถัดไป)
  const groups=(()=>{const m=new Map<string,{label:string,yo:number,so:number,list:any[]}>();for(const s of filtered){const sem=s.semester,ay=sem?.academicYear,k=String(sem?.id||"none");let g=m.get(k);if(!g){g={label:String(sem?.name||"วิชา"),yo:Number(ay?.order||0),so:Number(sem?.order||0),list:[]};m.set(k,g)}g.list.push(s)}return[...m.values()].sort((a,b)=>a.yo-b.yo||a.so-b.so)})();
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
  <View style={styles.header}><View><Text style={styles.mini}>MY LEARNING</Text><Text style={font.h1}>วิชาของฉัน</Text><Text style={font.body}>ทุกวิชาอยู่ใน Knowledge Base เดียว</Text></View><IconTile icon="library" color={colors.accent} size={50}/></View>
   <Card style={styles.search}><Ionicons name="search" size={18} color={colors.textMuted}/><TextInput value={q} onChangeText={setQ} placeholder="ค้นหาวิชา..." placeholderTextColor={colors.textMuted} style={styles.searchInput}/>{q.length>0?<Pressable onPress={()=>setQ("")} hitSlop={8}><Ionicons name="close-circle" size={17} color={colors.textMuted}/></Pressable>:null}</Card>
   <SectionHeader title="กำลังเรียน" action={q.trim()?`พบ ${filtered.length} จาก ${subjects.length}`:subjects.length+" วิชา"}/>
   {groups.map((g,gi)=><View key={"g"+gi}>
     <View style={styles.termRow}><View style={[styles.termDot,{backgroundColor:gi%2?"#38bdf8":"#a78bfa"}]}/><Text style={styles.termText}>{g.label}</Text><Text style={styles.termCount}>{g.list.length} วิชา</Text></View>
     {g.list.map((s,i)=>{const mastery=Number(s.progress?.[0]?.mastery||0);return <Pressable key={s.id} onPress={()=>router.push(("/subject/"+s.id) as any)}><Card style={styles.course}><View style={styles.courseTop}><View style={styles.courseIcon}><Ionicons name={i%2?"code-slash":"server-outline"} size={23} color={i%2?"#38bdf8":"#a78bfa"}/></View><View style={styles.info}><View style={styles.titleRow}><Text style={font.title}>{s.code?s.code+" · ":""}{s.name}</Text><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></View><Text style={font.caption}>{s._count?.materials||0} เนื้อหา · {mastery<30?"เริ่มต้น":mastery<70?"กำลังเรียน":"ใกล้เชี่ยวชาญ"}</Text></View></View><View style={styles.progressRow}><ProgressBar value={mastery} color={i%2?"#38bdf8":"#a78bfa"}/><Text style={styles.pct}>{Math.round(mastery)}%</Text></View></Card></Pressable>})}
   </View>)}
   {!subjects.length&&<Card><Text style={font.body}>ยังไม่มีวิชา เริ่มสร้างวิชาแรกด้านล่าง</Text></Card>}
   {!!subjects.length&&!filtered.length&&<Card><Text style={font.body}>ไม่พบวิชาที่ตรงกับ &quot;{q.trim()}&quot;</Text><Button onPress={()=>setQ("")} variant="secondary" icon="close">ล้างคำค้น</Button></Card>}
 <SectionHeader title="สร้างเส้นทางการเรียน" />
 <Card style={styles.add}><Pill text="STEP 1"/><Text style={[font.title,{marginTop:8}]}>ปีการศึกษา + ภาคเรียน</Text><TextInput value={yearName} onChangeText={setYearName} placeholder="เช่น ปี 1" placeholderTextColor={colors.textMuted} style={styles.input}/><Button onPress={addYear} loading={busy} icon="add">เพิ่มปีการศึกษา</Button></Card>
 <Card style={styles.add}><Pill text="STEP 2" color="#38bdf8"/><Text style={[font.title,{marginTop:8}]}>วิชาใหม่</Text><TextInput value={subjectName} onChangeText={setSubjectName} placeholder="เช่น Database Systems" placeholderTextColor={colors.textMuted} style={styles.input}/><Button onPress={addSubject} loading={busy} icon="book-outline">สร้างวิชา</Button></Card>
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:900,alignSelf:"center",width:"100%"},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.xl},mini:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa",marginBottom:5},
 search:{flexDirection:"row",alignItems:"center",paddingVertical:10,marginBottom:spacing.xl},searchInput:{flex:1,color:colors.text,paddingHorizontal:10,fontSize:14},termRow:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:10,marginTop:2},termDot:{width:9,height:9,borderRadius:5},termText:{fontSize:15,fontWeight:"900",color:colors.text},termCount:{fontSize:11,fontWeight:"700",color:colors.textMuted},course:{marginBottom:10,padding:15},courseTop:{flexDirection:"row",gap:12,alignItems:"center"},courseIcon:{width:48,height:48,borderRadius:16,backgroundColor:colors.surfaceAlt,alignItems:"center",justifyContent:"center"},info:{flex:1},titleRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8},progressRow:{flexDirection:"row",alignItems:"center",gap:10,marginTop:14},pct:{fontSize:12,fontWeight:"900",color:colors.textSecondary,width:34,textAlign:"right"},add:{marginBottom:12},input:{minHeight:46,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,backgroundColor:colors.surfaceAlt,paddingHorizontal:14,color:colors.text,marginVertical:12}
});
