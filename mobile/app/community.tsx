import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { Alert } from "../lib/alert";
import { router } from "expo-router";
import { colors, font, spacing } from "../lib/theme";
import { Card, Button } from "../lib/ui";
import { getCommunity, createCommunityPost } from "../lib/api";
export default function Community(){
 const [posts,setPosts]=useState<any[]>([]);const[title,setTitle]=useState("");const[content,setContent]=useState("");const[busy,setBusy]=useState(false);
 async function load(){try{setPosts(await getCommunity())}catch(e){Alert.alert("โหลด Community ไม่สำเร็จ",String(e))}}
 useEffect(()=>{load()},[]);
 async function post(){if(!title.trim()||!content.trim())return;setBusy(true);try{await createCommunityPost(title,content);setTitle("");setContent("");await load()}catch(e){Alert.alert("โพสต์ไม่สำเร็จ",String(e))}finally{setBusy(false)}}
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><Pressable onPress={()=>(router.canGoBack?.()?router.back():router.replace("/(tabs)"))}><Text style={styles.back}>← กลับ</Text></Pressable><Text style={font.h1}>Community</Text><Text style={font.caption}>ถาม-ตอบและแบ่งปันการเรียนรู้</Text>
 <Card><TextInput value={title} onChangeText={setTitle} placeholder="หัวข้อ" placeholderTextColor={colors.textMuted} style={styles.input}/><TextInput value={content} onChangeText={setContent} multiline placeholder="เขียนคำถามหรือสิ่งที่อยากแบ่งปัน..." placeholderTextColor={colors.textMuted} style={[styles.input,styles.area]}/><Button onPress={post} loading={busy}>โพสต์</Button></Card>
 {posts.map(p=><Pressable key={p.id} onPress={()=>router.push(("/community/"+p.id) as any)}><Card><Text style={font.title}>{p.title}</Text><Text style={font.caption}>{p.user?.name||"นักศึกษา"} · {p._count?.comments||0} ความคิดเห็น</Text><Text style={font.body} numberOfLines={3}>{p.content}</Text></Card></Pressable>)}
 </ScrollView>
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},content:{padding:spacing.lg,gap:spacing.md,paddingBottom:50},back:{color:colors.accent,fontWeight:"700",marginBottom:8},input:{minHeight:48,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12,color:colors.text,marginBottom:8},area:{minHeight:100,textAlignVertical:"top"}});
