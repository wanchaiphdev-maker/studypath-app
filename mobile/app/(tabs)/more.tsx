import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { api } from "../../lib/api";
import { useTheme, colors, spacing, radius, font } from "../../lib/theme";
import { Avatar, Card } from "../../lib/ui";

type Me = { id: string; name: string; email: string; role: "ADMIN" | "LECTURER" | "MEMBER"; themeColor: string; };
export default function MoreScreen() {
  const { color, setColor } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [learning, setLearning] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const [profile, stats] = await Promise.all([api<Me>("/me"), api("/me/learning")]); setMe(profile); setLearning(stats); }
    catch (e) { Alert.alert("โหลดโปรไฟล์ไม่สำเร็จ", e instanceof Error ? e.message : "ลองใหม่อีกครั้ง"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const logout = async () => { await SecureStore.deleteItemAsync("token").catch(() => undefined); router.replace("/(auth)/login"); };
  if (loading) return <View style={styles.center}><ActivityIndicator color={color} /></View>;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {me && <View style={[styles.profile,{backgroundColor:color}]}><Avatar name={me.name} color="#ffffff33" size={56}/><View style={{flex:1}}><Text style={styles.name}>{me.name}</Text><Text style={styles.email}>{me.email}</Text><Text style={styles.role}>{me.role === "LECTURER" ? "อาจารย์" : me.role === "ADMIN" ? "ผู้ดูแลระบบ" : "นักศึกษา"}</Text></View></View>}
    <Text style={styles.section}>ภาพรวมการเรียน</Text>
    <Card><Text style={font.body}>วิชาที่ลงทะเบียน: {learning?.subjects ?? 0}</Text><Text style={font.body}>ทบทวนที่ถึงกำหนด: {learning?.dueReviews ?? 0}</Text><Text style={font.body}>งานที่ยังไม่เสร็จ: {learning?.planner ?? 0}</Text></Card>
    {me?.role !== "MEMBER" && <Pressable style={styles.item} onPress={async()=>{try{const x=await api<any>("/studypath/portal/overview");Alert.alert("StudyPath Portal",`ผู้ใช้ ${x.users} · วิชา ${x.subjects} · เอกสาร ${x.materials} · Quiz ${x.quizzes}`)}catch(e){Alert.alert("Portal",e instanceof Error?e.message:"ไม่มีสิทธิ์")}}}><Ionicons name="school-outline" size={20} color={color}/><Text style={styles.itemText}>University / Lecturer Portal</Text><Ionicons name="chevron-forward" size={20} color={colors.textMuted}/></Pressable>}
    <Text style={styles.section}>สีธีม</Text><Card><View style={styles.colors}>{["#2563eb","#147d64","#7c3aed","#db2777","#ea580c","#0891b2"].map(c=><Pressable key={c} onPress={()=>{setColor(c);void api("/me",{method:"PATCH",body:JSON.stringify({themeColor:c})}).catch(()=>undefined)}} style={[styles.swatch,{backgroundColor:c,borderColor:me?.themeColor===c?colors.text:"transparent"}]} />)}</View></Card>
    <Pressable style={styles.logout} onPress={logout}><Ionicons name="log-out-outline" size={19} color={colors.danger}/><Text style={{color:colors.danger,fontWeight:"700"}}>ออกจากระบบ</Text></Pressable>
    <Text style={styles.footer}>StudyPath · Personal Learning OS</Text>
  </ScrollView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,paddingBottom:spacing.xxxl},center:{flex:1,alignItems:"center",justifyContent:"center"},profile:{flexDirection:"row",alignItems:"center",borderRadius:radius.xl,padding:spacing.xl,gap:spacing.lg,marginBottom:spacing.xl},name:{color:"#fff",fontSize:20,fontWeight:"700"},email:{color:"#ffffffd9",fontSize:13},role:{color:"#fff",marginTop:6,fontWeight:"600"},section:{...font.h3,marginBottom:spacing.md,marginTop:spacing.lg},item:{flexDirection:"row",alignItems:"center",gap:spacing.md,padding:spacing.lg,borderRadius:radius.lg,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},itemText:{...font.label,flex:1},colors:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md},swatch:{width:44,height:44,borderRadius:22,borderWidth:3},logout:{marginTop:spacing.xl,flexDirection:"row",justifyContent:"center",alignItems:"center",gap:8,padding:spacing.lg,borderWidth:1,borderColor:"#f0c9c6",borderRadius:radius.md},footer:{...font.caption,textAlign:"center",marginTop:spacing.xxl}});
