import {useEffect,useState} from "react";
import {Alert,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {colors,font,radius,spacing} from "../../lib/theme";
import {Button,Card,GlowCard,Pill} from "../../lib/ui";
import {askMaterial,getSubjects} from "../../lib/api";

export default function Tutor(){
 const[subjects,setSubjects]=useState<any[]>([]),[question,setQuestion]=useState(""),[answer,setAnswer]=useState<any>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{getSubjects().then(setSubjects).catch(()=>undefined)},[]);
 async function ask(){const material=subjects[0]?.materials?.[0];if(!material){Alert.alert("AI Tutor","เพิ่ม Material ในวิชาก่อน");return}if(!question.trim())return;setBusy(true);try{setAnswer(await askMaterial(material.id,question))}catch(e){Alert.alert("AI Tutor",String(e))}finally{setBusy(false)}}
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
  <View style={styles.header}><View><Text style={styles.mini}>STUDYPATH AI</Text><Text style={font.h1}>AI Tutor</Text><Text style={font.body}>ถามจากเนื้อหาที่อาจารย์สอนจริง</Text></View><View style={styles.ai}><Ionicons name="sparkles" size={24} color="#fff"/></View></View>
  <GlowCard style={styles.banner}><Text style={styles.bannerTitle}>Your personal tutor</Text><Text style={styles.bannerText}>AI จะยึดสไลด์ เอกสาร และ Lecture Recording ใน Knowledge Base เป็นหลักฐาน</Text><View style={styles.chips}><Pill text="Grounded AI" color="#fff"/><Pill text="มี Source" color="#fff"/></View></GlowCard>
  <Card style={styles.chat}><View style={styles.chatHead}><View style={styles.bot}><Ionicons name="sparkles" size={16} color={colors.accent}/></View><View><Text style={font.title}>StudyPath Tutor</Text><Text style={font.caption}>พร้อมช่วยอธิบายแบบทีละขั้น</Text></View></View>
   <View style={styles.tip}><Text style={font.caption}>ลองถาม</Text><Text style={font.body}>“อธิบายหัวข้อนี้ให้เหมือนอาจารย์สอนใหม่”</Text></View>
   {answer?<View style={styles.answer}><Text style={styles.answerTag}>{answer.grounded?"✓ GROUNDED IN YOUR MATERIALS":"ไม่พบ Source ที่ตรงพอ"}</Text><Text style={font.body}>{answer.answer}</Text>{answer.sources?.length?<Text style={font.caption}>Sources: {answer.sources.length} ส่วนของเนื้อหา</Text>:null}</View>:null}
   <TextInput value={question} onChangeText={setQuestion} multiline placeholder="ถามเกี่ยวกับบทเรียน..." placeholderTextColor={colors.textMuted} style={styles.input}/>
   <Button onPress={ask} loading={busy} icon="send">ถาม AI Tutor</Button>
  </Card>
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:760,alignSelf:"center",width:"100%"},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.xl},mini:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa",marginBottom:5},ai:{width:52,height:52,borderRadius:18,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center"},
 banner:{marginBottom:spacing.lg},bannerTitle:{fontSize:22,fontWeight:"900",color:"#fff"},bannerText:{color:"#e9e7ff",lineHeight:20,marginTop:8},chips:{flexDirection:"row",gap:8,marginTop:14},chat:{padding:16},chatHead:{flexDirection:"row",alignItems:"center",gap:10},bot:{width:34,height:34,borderRadius:12,backgroundColor:"#a78bfa22",alignItems:"center",justifyContent:"center"},tip:{backgroundColor:colors.surfaceAlt,borderRadius:14,padding:12,marginVertical:14},answer:{borderLeftWidth:3,borderLeftColor:colors.accent,paddingLeft:12,gap:8,marginBottom:14},answerTag:{fontSize:10,fontWeight:"900",color:colors.success},input:{minHeight:110,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:14,color:colors.text,textAlignVertical:"top",backgroundColor:colors.surfaceAlt,marginBottom:12}
});