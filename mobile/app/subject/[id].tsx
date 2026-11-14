import {useEffect,useState} from "react";
import {Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import { Alert } from "../../lib/alert";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import {requestRecordingPermissionsAsync,setAudioModeAsync,useAudioRecorder,useAudioRecorderState,RecordingPresets} from "expo-audio";
import {useLocalSearchParams,router} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {colors,font,spacing} from "../../lib/theme";
import {Button,Card,GlowCard,IconTile,Pill,ProgressBar,SectionHeader} from "../../lib/ui";
import {createMaterial,getSubject,uploadMaterial} from "../../lib/api";

export default function SubjectDetail(){
 const{id}=useLocalSearchParams<{id:string}>();const[subject,setSubject]=useState<any>(null),[title,setTitle]=useState(""),[text,setText]=useState(""),[busy,setBusy]=useState(false),[noteOpen,setNoteOpen]=useState(false);
 const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);const state=useAudioRecorderState(recorder);
 useEffect(()=>{setAudioModeAsync({playsInSilentMode:true,allowsRecording:true}).catch(()=>{})},[]);
 async function load(){try{setSubject(await getSubject(String(id)))}catch(e){Alert.alert("โหลดวิชาไม่สำเร็จ",String(e))}}useEffect(()=>{load()},[id]);
 async function addMaterial(){if(!text.trim())return;setBusy(true);try{await createMaterial(String(id),title||"Lecture Note",text);setText("");setTitle("");await load()}catch(e){Alert.alert("เพิ่มเอกสารไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 async function record(){try{if(state.isRecording){await recorder.stop();const uri=recorder.uri;if(!uri)return;setBusy(true);await uploadMaterial(String(id),{uri,name:"lecture-"+Date.now()+".m4a",mimeType:"audio/mp4"},title||"Lecture Recording");setTitle("");await load();Alert.alert("สำเร็จ","ถอดเสียงและรวมเข้า Knowledge Base แล้ว");setBusy(false)}else{const p=await requestRecordingPermissionsAsync();if(!p.granted){Alert.alert("ต้องอนุญาตไมโครโฟน");return}await recorder.prepareToRecordAsync();recorder.record()}}catch(e){setBusy(false);Alert.alert("บันทึกเสียงไม่สำเร็จ",String(e))}}
 async function pick(){setBusy(true);try{const r=await DocumentPicker.getDocumentAsync({type:["application/pdf","text/plain","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.ms-powerpoint","audio/*","video/*"],copyToCacheDirectory:true,multiple:false});if(r.canceled||!r.assets?.[0])return;const f=r.assets[0];await uploadMaterial(String(id),{uri:f.uri,name:f.name||"learning-material",mimeType:f.mimeType||"application/pdf"},title||f.name);setTitle("");await load();Alert.alert("สำเร็จ","เพิ่มเนื้อหาเข้า Knowledge Base แล้ว")}catch(e){Alert.alert("อัปโหลดไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 if(!subject)return <View style={styles.loading}><Text style={font.body}>กำลังโหลด...</Text><Pressable onPress={()=>router.canGoBack()?router.back():router.replace("/(tabs)/subjects" as any)} style={{marginTop:18,flexDirection:"row",alignItems:"center",gap:8,padding:12,borderRadius:12,backgroundColor:colors.surfaceAlt}}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={font.body}>กลับไปหน้ารายวิชา</Text></Pressable></View>
 const mastery=Number(subject.progress?.[0]?.mastery||0);
 const allMaterials=subject.materials||[];
 const isAttendance=(m:any)=>m.category==="checkin"||/เช็คชื่อ|เช็กชื่อ|ตรวจชื่อ|ลงชื่อ|เข้าเรียน|เช็คการเข้าเรียน|เช็กการเข้าเรียน|attendance|check[ -]?in|roll[ -]?call/i.test(String(m.title||"")) || (/forms\.gle|docs\.google\.com\/forms/i.test(String(m.externalUrl||"")) && /เช็ค|เช็ก|ลงชื่อ|เข้าเรียน|attendance|check[ -]?in/i.test(String(m.title||"")+" "+String(m.textContent||"")));
 const attendanceMaterials=allMaterials.filter(isAttendance);
 const learningMaterials=allMaterials.filter((m:any)=>!isAttendance(m));
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
  ? learningMaterials.filter((m:any)=>!CATS.includes(String(m.category||"")))
  : learningMaterials.filter((m:any)=>String(m.category||"")===b.k)}));
 const fmtWhen=(v:any)=>{if(!v)return "";const d=new Date(v);if(isNaN(d.getTime()))return "";return d.toLocaleDateString("th-TH",{day:"numeric",month:"short"});};
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
  {/* ไอคอน "?" (แบบทดสอบ) ถูกเอาออก — ฟังก์ชันข้อสอบอยู่ที่แท็บ "ข้อสอบ" แล้ว (ตามที่ผู้ใช้เลือก) */}
  <View style={styles.header}><Pressable onPress={()=>router.back()}><IconTile icon="arrow-back" color={colors.textSecondary} size={40}/></Pressable><View style={{flex:1,marginLeft:10}}><Text style={styles.mini}>COURSE</Text><Text style={font.title}>{subject.code||"Subject"}</Text></View></View>
  <GlowCard style={styles.hero}><Text style={styles.heroEyebrow}>CURRENT COURSE</Text><Text style={styles.heroTitle}>{subject.name}</Text><View style={styles.heroBottom}><View><Text style={styles.heroPct}>{Math.round(mastery)}%</Text><Text style={styles.heroCaption}>Mastery</Text></View><View style={{flex:1,marginLeft:18}}><ProgressBar value={mastery} color="#fff"/><Text style={styles.heroCaption}>{subject.materials?.length||0} learning materials</Text></View></View></GlowCard>
  <SectionHeader title="เพิ่มเนื้อหา" />
  <Card><Text style={font.body}>รวมสไลด์อาจารย์ เสียงในห้อง และโน้ตไว้ใน Knowledge Base เดียว</Text><View style={styles.actions}>
   <Pressable onPress={pick} style={styles.action}><IconTile icon="cloud-upload-outline" color="#38bdf8"/><Text style={styles.actionTitle}>อัปโหลด</Text><Text style={styles.actionSub}>PDF · PPTX · Audio</Text></Pressable>
   <Pressable onPress={record} style={[styles.action,state.isRecording&&styles.recording]}><IconTile icon={state.isRecording?"stop-circle":"mic-outline"} color="#34d399"/><Text style={styles.actionTitle}>{state.isRecording?"หยุดบันทึก":"อัดเสียง"}</Text><Text style={styles.actionSub}>{state.isRecording?Math.round(state.durationMillis/1000)+" วินาที":"Lecture Recording"}</Text></Pressable>
   <Pressable onPress={()=>setNoteOpen(v=>!v)} style={[styles.action,noteOpen&&{borderWidth:1,borderColor:"#a855f7"}]}><IconTile icon="create-outline" color="#a855f7"/><Text style={styles.actionTitle}>เพิ่มโน้ต</Text><Text style={styles.actionSub}>{noteOpen?"กดเพื่อปิด":"Lecture note"}</Text></Pressable>
  </View>
  <TextInput value={title} onChangeText={setTitle} placeholder="ชื่อเนื้อหา (ถ้าต้องการ)" placeholderTextColor={colors.textMuted} style={styles.input}/>
  {(noteOpen||text!=="")?<><TextInput value={text} onChangeText={setText} multiline autoFocus={noteOpen&&text===""} placeholder="วางข้อความจาก Lecture..." placeholderTextColor={colors.textMuted} style={[styles.input,styles.textarea]}/>{text!==""?<Button onPress={addMaterial} loading={busy} icon="checkmark">บันทึกโน้ตเข้า Knowledge Base</Button>:<Button onPress={()=>setNoteOpen(false)} variant="secondary" icon="close">ยกเลิก</Button>}</>:null}
  {text!==""?<Button onPress={addMaterial} loading={busy} icon="checkmark">บันทึกโน้ตเข้า Knowledge Base</Button>:null}</Card>
  <SectionHeader title="เช็คชื่อ / เข้าเรียน" action={attendanceMaterials.length+" รายการ"}/>
  {attendanceMaterials.length===0?<Card><Text style={font.caption}>ยังไม่พบรายการเช็คชื่อในวิชานี้ รายการเช็คชื่อที่มีคำว่า “เช็คชื่อ”, “ลงชื่อ”, “Attendance” หรือ “Check-in” จะแสดงในส่วนนี้</Text></Card>:attendanceMaterials.map((m:any)=><Pressable key={m.id} onPress={()=>m.externalUrl?Linking.openURL(m.externalUrl).catch(()=>Alert.alert("เปิดลิงก์ไม่สำเร็จ")):undefined}><Card style={styles.material}><IconTile icon="checkbox-outline" color="#f59e0b" size={42}/><View style={{flex:1}}><Text style={font.title}>{m.title}</Text><Text style={font.caption}>รายการเช็คชื่อ · {m.status}</Text>{m.externalUrl?<Text style={font.caption}>แตะเพื่อเปิดแบบฟอร์ม</Text>:null}</View><Pill text={m.externalUrl?"เปิดเช็คชื่อ":"รายการ"} color="#f59e0b"/></Card></Pressable>)}
  {learningMaterials.length===0?<Card><Text style={font.caption}>ยังไม่มีไฟล์เนื้อหา ลองซิงก์ Google Classroom หรืออัปโหลดสไลด์/PDF</Text></Card>:bucketed.filter(b=>b.items.length).map(b=><View key={b.k}><SectionHeader title={b.t} action={b.items.length+" รายการ"}/>{b.items.map((m:any)=><Pressable key={m.id} onPress={()=>m.externalUrl?Linking.openURL(m.externalUrl).catch(()=>Alert.alert("เปิดลิงก์ไม่สำเร็จ")):undefined}><Card style={styles.material}><IconTile icon={b.i as any} color={b.c} size={42}/><View style={{flex:1}}><Text style={font.title} numberOfLines={2}>{m.title}</Text><Text style={font.caption}>{fmtWhen(m.externalUpdatedAt)?fmtWhen(m.externalUpdatedAt)+" · ":""}{m.sourceLabel||m.sourceType}</Text>{m.externalUrl?<Text style={font.caption}>แตะเพื่อเปิด</Text>:null}</View><Pill text={b.p} color={b.c}/></Card></Pressable>)}</View>)}
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:900,alignSelf:"center",width:"100%"},loading:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:colors.background},header:{flexDirection:"row",alignItems:"center",marginBottom:spacing.md},mini:{fontSize:9,fontWeight:"900",letterSpacing:1.5,color:"#a78bfa"},hero:{marginBottom:spacing.lg},heroEyebrow:{fontSize:10,fontWeight:"900",letterSpacing:1.5,color:"#ede9fe"},heroTitle:{fontSize:25,fontWeight:"900",color:"#fff",marginTop:5},heroBottom:{flexDirection:"row",alignItems:"flex-end",marginTop:24},heroPct:{fontSize:32,fontWeight:"900",color:"#fff"},heroCaption:{fontSize:11,color:"#ede9fe",marginTop:4},actions:{flexDirection:"row",gap:8,marginTop:16},action:{flex:1,backgroundColor:colors.surfaceAlt,borderRadius:16,padding:12,gap:7},actionTitle:{fontSize:12,fontWeight:"900",color:colors.text},actionSub:{fontSize:10,color:colors.textMuted},recording:{borderWidth:1,borderColor:colors.danger},input:{minHeight:46,borderWidth:1,borderColor:colors.border,borderRadius:14,backgroundColor:colors.surfaceAlt,paddingHorizontal:13,color:colors.text,marginTop:12},textarea:{minHeight:105,textAlignVertical:"top",paddingTop:13},material:{flexDirection:"row",alignItems:"center",gap:10,padding:13,marginBottom:8},aiHead:{flexDirection:"row",alignItems:"center",gap:10},answer:{marginTop:14,padding:13,borderRadius:14,backgroundColor:colors.surfaceAlt,gap:7},grounded:{fontSize:10,fontWeight:"900",color:colors.success},bottomActions:{gap:9,marginTop:8}
});
