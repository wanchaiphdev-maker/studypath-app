import {useCallback,useEffect,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import { Alert } from "../../lib/alert";
import {Ionicons} from "@expo/vector-icons";
import {router} from "expo-router";
import {api} from "../../lib/api";
import {useTheme,colors,font,radius,spacing} from "../../lib/theme";
import {Avatar,Card,IconTile,SectionHeader} from "../../lib/ui";
import {removeToken} from "../../lib/storage";

type Me={id:string;name:string;email:string;role:"ADMIN"|"LECTURER"|"MEMBER";themeColor:string};
export default function MoreScreen(){
 const{setColor}=useTheme();const[me,setMe]=useState<Me|null>(null);const[learning,setLearning]=useState<any>(null);const[loading,setLoading]=useState(true);
 const load=useCallback(async()=>{try{const[p,s]=await Promise.all([api<Me>("/me"),api("/me/learning")]);setMe(p);setLearning(s)}catch(e){Alert.alert("โหลดโปรไฟล์ไม่สำเร็จ",String(e))}finally{setLoading(false)}},[]);
 useEffect(()=>{const timer=setTimeout(()=>{void load()},0);return()=>clearTimeout(timer)},[load]);
 if(loading)return <View style={styles.center}><ActivityIndicator color={colors.accent}/></View>;
 async function logout(){await removeToken();router.replace("/(auth)/login")}
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
  <Text style={styles.mini}>ACCOUNT</Text><Text style={font.h1}>โปรไฟล์</Text>
  {me&&<Card style={styles.profile}><Avatar name={me.name} size={58}/><View style={{flex:1}}><Text style={font.h2}>{me.name}</Text><Text style={font.caption}>{me.email}</Text><View style={styles.role}><Ionicons name="shield-checkmark" size={13} color={colors.accent}/><Text style={styles.roleText}>{me.role==="LECTURER"?"อาจารย์":me.role==="ADMIN"?"ผู้ดูแลระบบ":"นักศึกษา"}</Text></View></View></Card>}
  <SectionHeader title="Learning overview"/>
  <View style={styles.grid}><Card style={styles.metric}><IconTile icon="library-outline" color="#a855f7" size={38}/><Text style={styles.metricNum}>{learning?.subjects||0}</Text><Text style={font.caption}>วิชา</Text></Card><Card style={styles.metric}><IconTile icon="repeat" color="#34d399" size={38}/><Text style={styles.metricNum}>{learning?.dueReviews||0}</Text><Text style={font.caption}>Review due</Text></Card><Card style={styles.metric}><IconTile icon="calendar-outline" color="#38bdf8" size={38}/><Text style={styles.metricNum}>{learning?.planner||0}</Text><Text style={font.caption}>งานค้าง</Text></Card></View>
  {me?.role!=="MEMBER"&&<Pressable style={styles.menu} onPress={async()=>{try{const x=await api<any>("/studypath/portal/overview");Alert.alert("University Portal","ผู้ใช้ "+x.users+" · วิชา "+x.subjects+" · เอกสาร "+x.materials+" · Quiz "+x.quizzes)}catch(e){Alert.alert("Portal",String(e))}}}><IconTile icon="school-outline" color="#38bdf8" size={42}/><View style={{flex:1}}><Text style={font.title}>University / Lecturer Portal</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted}/></Pressable>}
  <SectionHeader title="สีประจำตัว"/>
  <Card><View style={styles.colors}>{["#7c3aed","#2563eb","#0891b2","#147d64","#db2777","#ea580c"].map(c=><Pressable key={c} onPress={()=>{setColor(c);void api("/me",{method:"PATCH",body:JSON.stringify({themeColor:c})}).catch(()=>undefined)}} style={[styles.swatch,{backgroundColor:c,borderColor:me?.themeColor===c?"#fff":"transparent"}]}/>)}</View></Card>
  <Pressable style={styles.logout} onPress={logout}><Ionicons name="log-out-outline" size={19} color={colors.danger}/><Text style={{color:colors.danger,fontWeight:"900"}}>ออกจากระบบ</Text></Pressable>
  <Text style={styles.footer}>StudyPath · Personal Learning OS</Text>
 </ScrollView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:110,maxWidth:760,alignSelf:"center",width:"100%"},center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:colors.background},mini:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa",marginBottom:5},profile:{flexDirection:"row",alignItems:"center",gap:14,marginVertical:spacing.lg},role:{flexDirection:"row",alignItems:"center",gap:5,marginTop:7},roleText:{fontSize:11,fontWeight:"800",color:colors.accent},grid:{flexDirection:"row",gap:9,marginBottom:spacing.lg},metric:{flex:1,padding:13},metricNum:{fontSize:22,fontWeight:"900",color:colors.text,marginTop:7},menu:{flexDirection:"row",alignItems:"center",gap:12,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.lg,padding:14,marginBottom:spacing.lg},colors:{flexDirection:"row",flexWrap:"wrap",gap:12},swatch:{width:43,height:43,borderRadius:22,borderWidth:3},logout:{marginTop:spacing.xl,flexDirection:"row",justifyContent:"center",alignItems:"center",gap:8,padding:14,borderWidth:1,borderColor:"#ef5b6f44",borderRadius:radius.md},footer:{...font.caption,textAlign:"center",marginTop:spacing.xxl}
});