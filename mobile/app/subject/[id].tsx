import {useEffect,useState} from "react";
import {Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import { Alert } from "../../lib/alert";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import {requestRecordingPermissionsAsync,setAudioModeAsync,useAudioRecorder,useAudioRecorderState,RecordingPresets} from "expo-audio";
import {useLocalSearchParams,router} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {colors,font,spacing} from "../../lib/theme";
import {Button,Card,GlowCard,IconTile,Pill,ProgressBar,SectionHeader} from "../../lib/ui";
import {createMaterial,getSubject,uploadMaterial} from "../../lib/api";

/* ชนิดไฟล์ที่รับอัปโหลด — ให้ตรงกับที่ backend รองรับ */
const UPLOAD_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "image/*",
  "audio/*",
  "video/*",
];

/** บางเบราว์เซอร์ไม่บอก MIME ของไฟล์ → เดาจากนามสกุล */
function guessMime(name: string) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "text/markdown";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".wav")) return "audio/wav";
  if (/\.(ogg|opus)$/.test(n)) return "audio/ogg";
  if (n.endsWith(".webm")) return "audio/webm";
  if (/\.(mp4|mov|m4v)$/.test(n)) return "video/mp4";
  return "";
}

/** แยกชนิดไฟล์ที่อัปโหลด เพื่อแสดงไอคอน/สี/ป้ายให้ตรงกับไฟล์จริง */
function uploadKind(m: any) {
  const mime = String(m?.mimeType || "").toLowerCase();
  const name = String(m?.fileName || m?.title || "").toLowerCase();
  if (mime.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|opus)$/.test(name)) return { label: "ไฟล์เสียง", icon: "mic-outline", color: "#34d399", short: "เสียง" };
  if (mime.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(name)) return { label: "วิดีโอ", icon: "videocam-outline", color: "#f43f5e", short: "VDO" };
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic)$/.test(name)) return { label: "รูปภาพ", icon: "image-outline", color: "#f59e0b", short: "รูป" };
  if (mime === "application/pdf" || /\.pdf$/.test(name)) return { label: "PDF", icon: "document-outline", color: "#fb7185", short: "PDF" };
  if (mime.includes("presentation") || /\.(pptx?|key)$/.test(name)) return { label: "สไลด์", icon: "easel-outline", color: "#38bdf8", short: "สไลด์" };
  if (mime.includes("wordprocessing") || /\.(docx?|rtf|odt)$/.test(name)) return { label: "เอกสาร", icon: "document-text-outline", color: "#a78bfa", short: "DOCX" };
  if (mime.includes("spreadsheet") || /\.(xlsx?|csv)$/.test(name)) return { label: "ตาราง", icon: "grid-outline", color: "#10b981", short: "ตาราง" };
  return { label: "ไฟล์", icon: "document-attach-outline", color: "#94a3b8", short: "ไฟล์" };
}

export default function SubjectDetail(){
 const{id}=useLocalSearchParams<{id:string}>();const[subject,setSubject]=useState<any>(null),[title,setTitle]=useState(""),[text,setText]=useState(""),[busy,setBusy]=useState(false),[noteOpen,setNoteOpen]=useState(false);
 const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);const state=useAudioRecorderState(recorder);
 useEffect(()=>{setAudioModeAsync({playsInSilentMode:true,allowsRecording:true}).catch(()=>{})},[]);
 async function load(){try{setSubject(await getSubject(String(id)))}catch(e){Alert.alert("โหลดวิชาไม่สำเร็จ",String(e))}} useEffect(()=>{let alive=true;const timer=setTimeout(()=>{void getSubject(String(id)).then(v=>{if(alive)setSubject(v)}).catch(e=>{if(alive)Alert.alert("โหลดวิชาไม่สำเร็จ",String(e))})},0);return()=>{alive=false;clearTimeout(timer)}},[id]);
 async function addMaterial(){if(!text.trim())return;setBusy(true);try{await createMaterial(String(id),title||"Lecture Note",text);setText("");setTitle("");await load()}catch(e){Alert.alert("เพิ่มเอกสารไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 async function record(){
  try{
   if(state.isRecording){
    await recorder.stop();
    const uri=recorder.uri;
    if(!uri)return;
    setBusy(true);
    // เว็บอัดเสียงเป็น webm ส่วนมือถือเป็น m4a — ส่งชนิดให้ตรงกับไฟล์จริง
    const isWeb=Platform.OS==="web";
    const now=new Date();
    const stamp=now.toLocaleDateString("th-TH",{day:"numeric",month:"short"})+" "+now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
    await uploadMaterial(String(id),{uri,name:`recording-${Date.now()}${isWeb?".webm":".m4a"}`,mimeType:isWeb?"audio/webm":"audio/mp4"},title.trim()||`อัดเสียง ${stamp}`);
    setTitle("");
    await load();
    Alert.alert("สำเร็จ","บันทึกเสียงและถอดข้อความเข้า Knowledge Base แล้ว");
    setBusy(false);
   }else{
    const p=await requestRecordingPermissionsAsync();
    if(!p.granted){Alert.alert("ต้องอนุญาตไมโครโฟน");return}
    await recorder.prepareToRecordAsync();
    recorder.record();
   }
  }catch(e){setBusy(false);Alert.alert("บันทึกเสียงไม่สำเร็จ",String(e))}
 }
 async function pick(){
  setBusy(true);
  try{
   const r=await DocumentPicker.getDocumentAsync({type:UPLOAD_MIMES,copyToCacheDirectory:true,multiple:false});
   if(r.canceled||!r.assets?.[0])return;
   const f:any=r.assets[0];
   const mimeType=f.mimeType||guessMime(f.name||"");
   await uploadMaterial(String(id),{uri:f.uri,name:f.name||"learning-material",mimeType,file:f.file},title||f.name);
   setTitle("");
   await load();
   Alert.alert("สำเร็จ","เพิ่มไฟล์เข้า Knowledge Base แล้ว");
  }catch(e){Alert.alert("อัปโหลดไม่สำเร็จ",String(e))}
  finally{setBusy(false)}
 }
 if(!subject)return <View style={styles.loading}><Text style={font.body}>กำลังโหลด...</Text><Pressable onPress={()=>router.canGoBack()?router.back():router.replace("/(tabs)/subjects" as any)} style={{marginTop:18,flexDirection:"row",alignItems:"center",gap:8,padding:12,borderRadius:12,backgroundColor:colors.surfaceAlt}}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={font.body}>กลับไปหน้ารายวิชา</Text></Pressable></View>
 const mastery=Number(subject.progress?.[0]?.mastery||0);
 const allMaterials=subject.materials||[];
 const isAttendance=(m:any)=>m.category==="checkin"||/เช็คชื่อ|เช็กชื่อ|ตรวจชื่อ|ลงชื่อ|เข้าเรียน|เช็คการเข้าเรียน|เช็กการเข้าเรียน|attendance|check[ -]?in|roll[ -]?call/i.test(String(m.title||"")) || (/forms\.gle|docs\.google\.com\/forms/i.test(String(m.externalUrl||"")) && /เช็ค|เช็ก|ลงชื่อ|เข้าเรียน|attendance|check[ -]?in/i.test(String(m.title||"")+" "+String(m.textContent||"")));
 const attendanceMaterials=allMaterials.filter(isAttendance);
 const learningMaterials=allMaterials.filter((m:any)=>!isAttendance(m));
 const subjectText=learningMaterials.map((m:any)=>`${m.title||""} ${m.textContent||""} ${m.category||""}`).join(" ").slice(0,12000);
 const subjectName=String(subject.name||"");
 const isProblemSolvingSubject=String(subject.code||"").trim()==="1204103"||/การแก้ปัญหาสำหรับวิทยาการคอมพิวเตอร์/i.test(subjectName);
 const isMathSubject=/คณิตศาสตร์|สถิติ|แคลคูลัส|คอมพิวเตอร์กับคณิต|mathematics|math|statistics|calculus/i.test(subjectName);
 const subjectHasCode=isProblemSolvingSubject||(!isMathSubject&&/(#include|\bprintf\s*\(|\bscanf\s*\(|\bcout\s*<<|\bcin\s*>>|\bfor\s*\(|\bwhile\s*\(|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|เขียนโปรแกรม|เขียนโค้ด|ภาษา C\+\+|ภาษา Java|ภาษา Python)/i.test(subjectText));
 const subjectHasFlowchart=isProblemSolvingSubject||(!isMathSubject&&/(ผังงาน|flow\s*chart|ผังภาพ|ลำดับการทำงาน|อัลกอริทึม|algorithm|กระบวนการ)/i.test(subjectText));
 // ไฟล์ที่ผู้ใช้อัปโหลด/อัดเสียงเอง (sourceType LECTURER) แยกออกมาแสดงเป็นรายไฟล์ เรียงใหม่สุดก่อน
 const uploadedMaterials=learningMaterials
  .filter((m:any)=>String(m.sourceType||"").toUpperCase()==="LECTURER")
  .sort((a:any,b:any)=>new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime());
 // ส่วนที่เหลือมาจาก Google Classroom → จัดกลุ่มตามหมวดเดิม
 const classroomMaterials=learningMaterials.filter((m:any)=>String(m.sourceType||"").toUpperCase()!=="LECTURER");
 // จัดกลุ่มตาม "หมวดวิชา" ที่ได้จาก Classroom (สไลด์/VDO/การบ้าน/งานในห้อง/โบนัส)
  // ลำดับกลุ่ม: เรียนก่อน (สไลด์ → VDO) แล้วค่อยฝึก (การบ้าน → งานในห้อง) แล้วโบนัส
  // ภายในกลุ่มเรียงตามลำดับบท/สัปดาห์ที่ backend จัดให้แล้ว (Chapter 1..10, WEEK#1..15)
 const CATS=["slide","vdo","homework","inclass","bonus"];
 const CAT_BUCKETS=[
  {k:"slide",t:"สไลด์ & เอกสารประกอบ",i:"document-text-outline",c:"#38bdf8",p:"สไลด์"},
  {k:"vdo",t:"VDO / คลิป",i:"videocam-outline",c:"#f43f5e",p:"VDO"},
  {k:"homework",t:"การบ้าน",i:"reader-outline",c:"#a78bfa",p:"การบ้าน"},
  {k:"inclass",t:"งานในห้อง",i:"create-outline",c:"#10b981",p:"ในห้อง"},
  {k:"bonus",t:"โบนัส",i:"gift-outline",c:"#f59e0b",p:"โบนัส"},
  {k:"other",t:"อื่น ๆ",i:"apps-outline",c:"#94a3b8",p:"อื่น"},
 ];
 const bucketed=CAT_BUCKETS.map(b=>({...b,items:b.k==="other"
  ? classroomMaterials.filter((m:any)=>!CATS.includes(String(m.category||"")))
  : classroomMaterials.filter((m:any)=>String(m.category||"")===b.k)}));
 const fmtWhen=(v:any)=>{if(!v)return "";const d=new Date(v);if(isNaN(d.getTime()))return "";return d.toLocaleDateString("th-TH",{day:"numeric",month:"short"});};
 // แตะไฟล์ที่อัปโหลด → ดูรายละเอียด + ข้อความที่อ่านได้ (ยืนยันว่าไฟล์เข้า Knowledge Base แล้ว)
 const showUploaded=(m:any)=>{
  const k=uploadKind(m);
  const meta=[
   k.label,
   m.pageCount?`${m.pageCount} หน้า`:"",
   m._count?.chunks?`${m._count.chunks} ชิ้นเนื้อหา`:"",
   fmtWhen(m.createdAt)?`อัปโหลด ${fmtWhen(m.createdAt)}`:"",
  ].filter(Boolean).join(" · ");
  const preview=String(m.textContent||"").replace(/\s+/g," ").trim().slice(0,600);
  Alert.alert(m.title, meta+(preview?`\n\n${preview}${preview.length>=600?"…":""}`:""));
 };
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
  {/* ไอคอน "?" (แบบทดสอบ) ถูกเอาออก — ฟังก์ชันข้อสอบอยู่ที่แท็บ "ข้อสอบ" แล้ว (ตามที่ผู้ใช้เลือก) */}
  <View style={styles.header}><Pressable onPress={()=>router.canGoBack()?router.back():router.replace("/(tabs)/subjects" as any)}><IconTile icon="arrow-back" color={colors.textSecondary} size={40}/></Pressable><View style={{flex:1,marginLeft:10}}><Text style={styles.mini}>COURSE</Text><Text style={font.title}>{subject.code||"Subject"}</Text></View></View>
  <GlowCard style={styles.hero}><Text style={styles.heroEyebrow}>CURRENT COURSE</Text><Text style={styles.heroTitle}>{subject.name}</Text><View style={styles.heroBottom}><View><Text style={styles.heroPct}>{Math.round(mastery)}%</Text><Text style={styles.heroCaption}>Mastery</Text></View><View style={{flex:1,marginLeft:18}}><ProgressBar value={mastery} color="#fff"/><Text style={styles.heroCaption}>{subject.materials?.length||0} learning materials</Text></View></View></GlowCard>
  <SectionHeader title="เครื่องมือของวิชานี้" />
  <View style={styles.subjectTools}>
   <Pressable onPress={()=>router.push((`/(tabs)/tutor?subjectId=${encodeURIComponent(String(id))}&tab=chat&action=ask`) as any)} style={styles.subjectTool}><IconTile icon="chatbubbles-outline" color="#a78bfa" size={42}/><View style={{flex:1}}><Text style={font.title}>ถาม AI Tutor</Text><Text style={font.caption}>อิงเฉพาะเนื้อหาในวิชานี้</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>
   <Pressable onPress={()=>router.push((`/(tabs)/tutor?subjectId=${encodeURIComponent(String(id))}&tab=diag&action=exam`) as any)} style={styles.subjectTool}><IconTile icon="checkbox-outline" color="#34d399" size={42}/><View style={{flex:1}}><Text style={font.title}>ฝึกข้อสอบ</Text><Text style={font.caption}>เลือกแบบที่เหมาะกับวิชานี้</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>
   {subjectHasFlowchart?<Pressable onPress={()=>router.push((`/(tabs)/tutor?subjectId=${encodeURIComponent(String(id))}&tab=diag&action=flowchart`) as any)} style={styles.subjectTool}><IconTile icon="git-branch-outline" color="#38bdf8" size={42}/><View style={{flex:1}}><Text style={font.title}>ฝึกผังภาพ / ขั้นตอน</Text><Text style={font.caption}>พบหลักฐานผังงานในเนื้อหาวิชา</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>:null}
   {isProblemSolvingSubject?<Pressable onPress={()=>router.push((`/(tabs)/tutor?subjectId=${encodeURIComponent(String(id))}&tab=diag&action=pseudocode`) as any)} style={styles.subjectTool}><IconTile icon="terminal-outline" color="#818cf8" size={42}/><View style={{flex:1}}><Text style={font.title}>ฝึกรหัสเทียม</Text><Text style={font.caption}>เฉพาะวิชา 1204103</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>:null}
   {isProblemSolvingSubject?<Pressable onPress={()=>router.push((`/(tabs)/tutor?subjectId=${encodeURIComponent(String(id))}&tab=diag&action=test_table`) as any)} style={styles.subjectTool}><IconTile icon="grid-outline" color="#f472b6" size={42}/><View style={{flex:1}}><Text style={font.title}>ฝึกตารางทดสอบ</Text><Text style={font.caption}>เฉพาะวิชา 1204103</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>:null}
   {subjectHasCode?<Pressable onPress={()=>router.push((`/(tabs)/tutor?subjectId=${encodeURIComponent(String(id))}&tab=diag&action=code`) as any)} style={styles.subjectTool}><IconTile icon="code-slash-outline" color="#f472b6" size={42}/><View style={{flex:1}}><Text style={font.title}>ฝึกเขียนโค้ด</Text><Text style={font.caption}>พบโค้ดจริงในเนื้อหาวิชา</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>:null}
  </View>
  <SectionHeader title="เพิ่มเนื้อหา" />
  <Card><View style={styles.actions}>
   <Pressable onPress={pick} style={styles.action}><IconTile icon="cloud-upload-outline" color="#38bdf8"/><Text style={styles.actionTitle}>อัปโหลด</Text></Pressable>
   <Pressable onPress={record} style={[styles.action,state.isRecording&&styles.recording]}><IconTile icon={state.isRecording?"stop-circle":"mic-outline"} color="#34d399"/><Text style={styles.actionTitle}>{state.isRecording?"หยุดบันทึก":"อัดเสียง"}</Text>{state.isRecording?<Text style={styles.actionSub}>{Math.round(state.durationMillis/1000)} วินาที</Text>:null}</Pressable>
   <Pressable onPress={()=>setNoteOpen(v=>!v)} style={[styles.action,noteOpen&&{borderWidth:1,borderColor:"#a855f7"}]}><IconTile icon="create-outline" color="#a855f7"/><Text style={styles.actionTitle}>เพิ่มโน้ต</Text></Pressable>
  </View>
  <TextInput value={title} onChangeText={setTitle} placeholder="ชื่อเนื้อหา (ถ้าต้องการ)" placeholderTextColor={colors.textMuted} style={styles.input}/>
  <Text style={styles.hint}>รองรับ PDF · สไลด์ PPTX · DOCX · XLSX · TXT/MD/CSV · รูปภาพ · เสียง/วิดีโอ (ไม่เกิน 25MB)</Text>
  {(noteOpen||text!=="")?<><TextInput value={text} onChangeText={setText} multiline autoFocus={noteOpen&&text===""} placeholder="วางข้อความจาก Lecture..." placeholderTextColor={colors.textMuted} style={[styles.input,styles.textarea]}/>{text!==""?<Button onPress={addMaterial} loading={busy} icon="checkmark">บันทึกโน้ตเข้า Knowledge Base</Button>:<Button onPress={()=>setNoteOpen(false)} variant="secondary" icon="close">ยกเลิก</Button>}</>:null}
  {text!==""?<Button onPress={addMaterial} loading={busy} icon="checkmark">บันทึกโน้ตเข้า Knowledge Base</Button>:null}</Card>
  <SectionHeader title="ไฟล์ที่อัปโหลด" action={uploadedMaterials.length+" ไฟล์"}/>
  {uploadedMaterials.length===0
   ?<Card><Text style={font.caption}>ยังไม่มีไฟล์ที่อัปโหลด — กด “อัปโหลด” หรือ “อัดเสียง” ด้านบน ไฟล์แต่ละไฟล์จะแสดงแยกเป็นรายการของตัวเอง</Text></Card>
   :uploadedMaterials.map((m:any)=>{
     const k=uploadKind(m);
     const meta=[k.label,m.pageCount?`${m.pageCount} หน้า`:"",m._count?.chunks?`${m._count.chunks} ชิ้นเนื้อหา`:"",fmtWhen(m.createdAt)].filter(Boolean).join(" · ");
     return <Pressable key={m.id} onPress={()=>showUploaded(m)}><Card style={styles.material}>
      <IconTile icon={k.icon as any} color={k.color} size={42}/>
      <View style={{flex:1}}>
       <Text style={font.title} numberOfLines={2}>{m.title}</Text>
       <Text style={font.caption}>{meta}</Text>
       {m.transcript?<Text style={styles.badgeOk}>ถอดเสียงแล้ว</Text>:null}
      </View>
      <Pill text={String(m.sourceLabel||k.short)} color={k.color}/>
     </Card></Pressable>;
    })}
  <SectionHeader title="เช็คชื่อ / เข้าเรียน" action={attendanceMaterials.length+" รายการ"}/>
  {attendanceMaterials.length===0?<Card><Text style={font.caption}>ยังไม่พบรายการเช็คชื่อในวิชานี้ รายการเช็คชื่อที่มีคำว่า “เช็คชื่อ”, “ลงชื่อ”, “Attendance” หรือ “Check-in” จะแสดงในส่วนนี้</Text></Card>:attendanceMaterials.map((m:any)=><Pressable key={m.id} onPress={()=>m.externalUrl?Linking.openURL(m.externalUrl).catch(()=>Alert.alert("เปิดลิงก์ไม่สำเร็จ")):undefined}><Card style={styles.material}><IconTile icon="checkbox-outline" color="#f59e0b" size={42}/><View style={{flex:1}}><Text style={font.title}>{m.title}</Text><Text style={font.caption}>รายการเช็คชื่อ · {m.status}</Text></View><Pill text={m.externalUrl?"เปิดเช็คชื่อ":"รายการ"} color="#f59e0b"/></Card></Pressable>)}
  {learningMaterials.length===0?<Card><Text style={font.caption}>ยังไม่มีไฟล์เนื้อหา ลองซิงก์ Google Classroom หรืออัปโหลดสไลด์/PDF</Text></Card>:classroomMaterials.length===0?null:bucketed.filter(b=>b.items.length).map(b=><View key={b.k}><SectionHeader title={b.t} action={b.items.length+" รายการ"}/>{b.items.map((m:any)=><Pressable key={m.id} onPress={()=>m.externalUrl?Linking.openURL(m.externalUrl).catch(()=>Alert.alert("เปิดลิงก์ไม่สำเร็จ")):undefined}><Card style={styles.material}><IconTile icon={b.i as any} color={b.c} size={42}/><View style={{flex:1}}><Text style={font.title} numberOfLines={2}>{m.title}</Text><Text style={font.caption}>{fmtWhen(m.externalUpdatedAt)?fmtWhen(m.externalUpdatedAt)+" · ":""}{m.sourceLabel||m.sourceType}</Text></View><Pill text={b.p} color={b.c}/></Card></Pressable>)}</View>)}
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:900,alignSelf:"center",width:"100%"},loading:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:colors.background},header:{flexDirection:"row",alignItems:"center",marginBottom:spacing.md},mini:{fontSize:9,fontWeight:"900",letterSpacing:1.5,color:"#a78bfa"},hero:{marginBottom:spacing.lg},heroEyebrow:{fontSize:10,fontWeight:"900",letterSpacing:1.5,color:"#ede9fe"},heroTitle:{fontSize:25,fontWeight:"900",color:"#fff",marginTop:5},heroBottom:{flexDirection:"row",alignItems:"flex-end",marginTop:24},heroPct:{fontSize:32,fontWeight:"900",color:"#fff"},heroCaption:{fontSize:11,color:"#ede9fe",marginTop:4},subjectTools:{gap:8,marginBottom:spacing.lg},subjectTool:{flexDirection:"row",alignItems:"center",gap:10,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:13},actions:{flexDirection:"row",gap:8,marginTop:16},action:{flex:1,backgroundColor:colors.surfaceAlt,borderRadius:16,padding:12,gap:7},actionTitle:{fontSize:12,fontWeight:"900",color:colors.text},actionSub:{fontSize:10,color:colors.textMuted},recording:{borderWidth:1,borderColor:colors.danger},input:{minHeight:46,borderWidth:1,borderColor:colors.border,borderRadius:14,backgroundColor:colors.surfaceAlt,paddingHorizontal:13,color:colors.text,marginTop:12},textarea:{minHeight:105,textAlignVertical:"top",paddingTop:13},hint:{fontSize:10,color:colors.textMuted,marginTop:8,lineHeight:15},badgeOk:{fontSize:10,fontWeight:"800",color:colors.success,marginTop:3},material:{flexDirection:"row",alignItems:"center",gap:10,padding:13,marginBottom:8},aiHead:{flexDirection:"row",alignItems:"center",gap:10},answer:{marginTop:14,padding:13,borderRadius:14,backgroundColor:colors.surfaceAlt,gap:7},grounded:{fontSize:10,fontWeight:"900",color:colors.success},bottomActions:{gap:9,marginTop:8}
});
