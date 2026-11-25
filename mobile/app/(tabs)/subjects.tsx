import {useCallback,useState} from "react";
import {ActivityIndicator,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import { Alert } from "../../lib/alert";
import {router,useFocusEffect} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {colors,font,spacing} from "../../lib/theme";
import {Button,Card,IconTile,ProgressBar,SectionHeader} from "../../lib/ui";
import {createSemester,createSubject,createYear,getCurriculum,getSubjects} from "../../lib/api";

type SemesterOption={id:string;label:string};

export default function SubjectsScreen(){
 const[subjects,setSubjects]=useState<any[]>([]),[q,setQ]=useState("");
 // ---- เพิ่มวิชาเอง (ไม่ต้องรอซิงก์ Google Classroom) ----
 const[addOpen,setAddOpen]=useState(false),[newName,setNewName]=useState(""),[newCode,setNewCode]=useState("");
 const[options,setOptions]=useState<SemesterOption[]>([]),[semesterId,setSemesterId]=useState(""),[saving,setSaving]=useState(false);
 async function load(){try{setSubjects(await getSubjects())}catch(e){Alert.alert("โหลดข้อมูลไม่สำเร็จ",String(e))}}
 useFocusEffect(useCallback(()=>{void load()},[]));
 async function openAdd(){
  setAddOpen(true);setNewName("");setNewCode("");
  try{
   const years:any[]=await getCurriculum();
   const list:SemesterOption[]=(years||[]).flatMap(y=>(y.semesters||[]).map((s:any)=>({id:s.id,label:`${y.name} · ${s.name}`})));
   setOptions(list);setSemesterId(list.length?list[list.length-1].id:"");
  }catch{setOptions([]);setSemesterId("")}
 }
 async function save(){
  const name=newName.trim(); if(!name||saving)return;
  setSaving(true);
  try{
   let semId=semesterId;
   if(!semId){
    // ครั้งแรกของบัญชีใหม่: สร้างปีการศึกษา/ภาคเรียนให้อัตโนมัติ (ใช้ปี พ.ศ. ปัจจุบัน)
    const year:any=await createYear(`ปีการศึกษา ${new Date().getFullYear()+543}`);
    const sem:any=await createSemester(year.id,"ภาคเรียนที่ 1");
    semId=sem.id;
   }
   await createSubject(semId,name,newCode.trim());
   setAddOpen(false);setNewName("");setNewCode("");
   await load();
  }catch(e){Alert.alert("เพิ่มวิชาไม่สำเร็จ",String(e))}finally{setSaving(false)}
 }
  const filtered=subjects.filter(s=>{const k=q.trim().toLowerCase();if(!k)return true;return(`${s.code||""} ${s.name}`).toLowerCase().includes(k);});
  // จัดกลุ่มตามเทอม — เรียงตามปีการศึกษา -> ภาคเรียน (กลุ่มที่เข้ามาทีหลัง = เทอมถัดไป)
  const groups=(()=>{const m=new Map<string,{label:string,yo:number,so:number,list:any[]}>();for(const s of filtered){const sem=s.semester,ay=sem?.academicYear,k=String(sem?.id||"none");let g=m.get(k);if(!g){g={label:String(sem?.name||"วิชา"),yo:Number(ay?.order||0),so:Number(sem?.order||0),list:[]};m.set(k,g)}g.list.push(s)}return[...m.values()].sort((a,b)=>a.yo-b.yo||a.so-b.so)})();
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
  <View style={styles.header}><View><Text style={styles.mini}>MY LEARNING</Text><Text style={font.h1}>วิชาของฉัน</Text></View><Pressable onPress={openAdd} accessibilityLabel="เพิ่มวิชา"><IconTile icon="add" color={colors.accent} size={50}/></Pressable></View>
   <Card style={styles.search}><Ionicons name="search" size={18} color={colors.textMuted}/><TextInput value={q} onChangeText={setQ} placeholder="ค้นหาวิชา..." placeholderTextColor={colors.textMuted} style={styles.searchInput}/>{q.length>0?<Pressable onPress={()=>setQ("")} hitSlop={8}><Ionicons name="close-circle" size={17} color={colors.textMuted}/></Pressable>:null}</Card>
   <SectionHeader title="กำลังเรียน" action={q.trim()?`พบ ${filtered.length} จาก ${subjects.length}`:subjects.length+" วิชา"}/>
   {groups.map((g,gi)=><View key={"g"+gi}>
     <View style={styles.termRow}><View style={[styles.termDot,{backgroundColor:gi%2?"#38bdf8":"#a78bfa"}]}/><Text style={styles.termText}>{g.label}</Text><Text style={styles.termCount}>{g.list.length} วิชา</Text></View>
     {g.list.map((s,i)=>{const mastery=Number(s.progress?.[0]?.mastery||0);return <Pressable key={s.id} onPress={()=>router.push(("/subject/"+s.id) as any)}><Card style={styles.course}><View style={styles.courseTop}><View style={styles.courseIcon}><Ionicons name={i%2?"code-slash":"server-outline"} size={23} color={i%2?"#38bdf8":"#a78bfa"}/></View><View style={styles.info}><View style={styles.titleRow}><Text style={font.title}>{s.code?s.code+" · ":""}{s.name}</Text><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></View><Text style={font.caption}>{s._count?.materials||0} เนื้อหา · {mastery<30?"เริ่มต้น":mastery<70?"กำลังเรียน":"ใกล้เชี่ยวชาญ"}</Text></View></View><View style={styles.progressRow}><ProgressBar value={mastery} color={i%2?"#38bdf8":"#a78bfa"}/><Text style={styles.pct}>{Math.round(mastery)}%</Text></View></Card></Pressable>})}
   </View>)}
   {!subjects.length&&<Card><Text style={font.body}>ยังไม่มีวิชา — กดปุ่ม + เพื่อเพิ่มวิชาเอง หรือซิงก์จาก Google Classroom</Text><View style={{marginTop:12}}><Button onPress={openAdd} icon="add">เพิ่มวิชาแรก</Button></View></Card>}
   {!!subjects.length&&!filtered.length&&<Card><Text style={font.body}>ไม่พบวิชาที่ตรงกับ &quot;{q.trim()}&quot;</Text><Button onPress={()=>setQ("")} variant="secondary" icon="close">ล้างคำค้น</Button></Card>}

   <Modal visible={addOpen} transparent animationType="fade" onRequestClose={()=>setAddOpen(false)}>
    <Pressable style={styles.backdrop} onPress={()=>setAddOpen(false)}>
     <Pressable style={styles.sheet} onPress={()=>undefined}>
      <View style={styles.sheetHead}><Text style={styles.sheetTitle}>เพิ่มวิชา</Text><Pressable onPress={()=>setAddOpen(false)} hitSlop={10}><Ionicons name="close" size={20} color={colors.textMuted}/></Pressable></View>
      <Text style={styles.label}>ชื่อวิชา</Text>
      <TextInput value={newName} onChangeText={setNewName} placeholder="เช่น โปรแกรมประยุกต์สำหรับสำนักงานดิจิทัล" placeholderTextColor={colors.textMuted} style={styles.input} autoFocus/>
      <Text style={styles.label}>รหัสวิชา (ไม่บังคับ)</Text>
      <TextInput value={newCode} onChangeText={setNewCode} placeholder="เช่น 0041024" placeholderTextColor={colors.textMuted} style={styles.input} autoCapitalize="characters"/>
      {options.length>0?<><Text style={styles.label}>ภาคเรียน</Text><View style={styles.chips}>{options.map(o=><Pressable key={o.id} onPress={()=>setSemesterId(o.id)} style={[styles.chip,semesterId===o.id&&styles.chipActive]}><Text style={[styles.chipText,semesterId===o.id&&styles.chipTextActive]}>{o.label}</Text></Pressable>)}</View></>:<Text style={styles.hint}>ระบบจะสร้างปีการศึกษาและภาคเรียนให้อัตโนมัติ</Text>}
      <View style={{marginTop:16}}>{saving?<View style={styles.saving}><ActivityIndicator color={colors.accent}/><Text style={font.caption}>กำลังบันทึก...</Text></View>:<Button onPress={save} icon="checkmark" disabled={!newName.trim()}>บันทึกวิชา</Button>}</View>
     </Pressable>
    </Pressable>
   </Modal>
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:900,alignSelf:"center",width:"100%"},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.xl},mini:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa",marginBottom:5},
 search:{flexDirection:"row",alignItems:"center",paddingVertical:10,marginBottom:spacing.xl},searchInput:{flex:1,color:colors.text,paddingHorizontal:10,fontSize:14},termRow:{flexDirection:"row",alignItems:"center",gap:8,marginBottom:10,marginTop:2},termDot:{width:9,height:9,borderRadius:5},termText:{fontSize:15,fontWeight:"900",color:colors.text},termCount:{fontSize:11,fontWeight:"700",color:colors.textMuted},course:{marginBottom:10,padding:15},courseTop:{flexDirection:"row",gap:12,alignItems:"center"},courseIcon:{width:48,height:48,borderRadius:16,backgroundColor:colors.surfaceAlt,alignItems:"center",justifyContent:"center"},info:{flex:1},titleRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8},progressRow:{flexDirection:"row",alignItems:"center",gap:10,marginTop:14},pct:{fontSize:12,fontWeight:"900",color:colors.textSecondary,width:34,textAlign:"right"},
 backdrop:{flex:1,backgroundColor:"#00000066",justifyContent:"center",padding:spacing.lg},sheet:{width:"100%",maxWidth:480,alignSelf:"center",backgroundColor:colors.surface,borderRadius:22,padding:20},sheetHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:6},sheetTitle:{fontSize:20,fontWeight:"900",color:colors.text},label:{fontSize:11,fontWeight:"800",color:colors.textMuted,marginTop:12,marginBottom:6},input:{height:48,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.background,paddingHorizontal:14,color:colors.text},hint:{fontSize:12,color:colors.textMuted,marginTop:12},chips:{flexDirection:"row",flexWrap:"wrap",gap:8},chip:{paddingHorizontal:12,paddingVertical:8,borderRadius:99,borderWidth:1,borderColor:colors.border},chipActive:{borderColor:colors.accent,backgroundColor:colors.accent+"18"},chipText:{fontSize:12,fontWeight:"700",color:colors.textSecondary},chipTextActive:{color:colors.accent},saving:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,height:48}
});
