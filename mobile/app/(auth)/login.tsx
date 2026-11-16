import {useEffect,useState} from "react";
import {ActivityIndicator,KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import { Alert } from "../../lib/alert";
import {LinearGradient} from "expo-linear-gradient";
import {router} from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {Ionicons} from "@expo/vector-icons";
import {getToken,setToken} from "../../lib/storage";
import {login} from "../../lib/api";
import {appReturnUrl,buildGoogleAuthUrl,parseAuthCallback} from "../../lib/googleAuth";
import {colors,spacing} from "../../lib/theme";
export default function LoginScreen(){
 const[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[googleBusy,setGoogleBusy]=useState(false);
 useEffect(()=>{getToken().then(t=>t&&router.replace("/(tabs)")).catch(()=>undefined)},[]);
 async function submit(){setBusy(true);setError("");try{await login(email.trim(),password);router.replace("/(tabs)")}catch(e){setError(e instanceof Error?e.message:"เข้าสู่ระบบไม่สำเร็จ")}finally{setBusy(false)}}
 async function google(){setGoogleBusy(true);setError("");try{if(Platform.OS==="web"){window.location.assign(buildGoogleAuthUrl());return;}const r=await WebBrowser.openAuthSessionAsync(buildGoogleAuthUrl(),appReturnUrl());if(r.type==="success"){const c=parseAuthCallback(r.url);if(c?.token){await setToken(c.token);router.replace("/(tabs)")}else if(c?.error)setError(c.error)}}catch(e){setError(e instanceof Error?e.message:"Google login ไม่สำเร็จ")}finally{setGoogleBusy(false)}}
 return <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":undefined} style={styles.screen}><ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
  <LinearGradient colors={colors.gradient as any} style={styles.brand}><View style={styles.logo}><Ionicons name="school" size={30} color="#fff"/></View><Text style={styles.brandName}>StudyPath</Text></LinearGradient>
  <View style={styles.form}><Text style={styles.kicker}>WELCOME BACK</Text><Text style={styles.title}>เข้าสู่ระบบ</Text>
   <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="อีเมล" placeholderTextColor="#8a8da5" style={styles.input}/>
   <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="รหัสผ่าน" placeholderTextColor="#8a8da5" style={styles.input} onSubmitEditing={submit}/>
   {error?<Text style={styles.error}>{error}</Text>:null}
   <Pressable onPress={submit} disabled={busy||!email||!password} style={[styles.primary,(busy||!email||!password)&&{opacity:.5}]}>{busy?<ActivityIndicator color="#fff"/>:<><Text style={styles.primaryText}>เข้าสู่ระบบ</Text><Ionicons name="arrow-forward" size={18} color="#fff"/></>}</Pressable>
   <View style={styles.divider}><View style={styles.line}/><Text style={styles.or}>หรือ</Text><View style={styles.line}/></View>
   <Pressable onPress={google} disabled={googleBusy} style={styles.social}>{googleBusy?<ActivityIndicator color={colors.text}/>:<><Text style={styles.google}>G</Text><Text style={styles.socialText}>เข้าสู่ระบบด้วย Google</Text></>}</Pressable>
   <Pressable onPress={()=>router.push("/(auth)/register")}><Text style={styles.signup}>ยังไม่มีบัญชี? <Text style={{fontWeight:"900"}}>สมัครสมาชิก</Text></Text></Pressable>
  </View>
 </ScrollView></KeyboardAvoidingView>
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.background},wrap:{padding:spacing.lg,paddingTop:40,paddingBottom:50},brand:{borderRadius:28,padding:26,alignItems:"center",marginBottom:22},logo:{width:62,height:62,borderRadius:21,backgroundColor:"#ffffff22",alignItems:"center",justifyContent:"center",marginBottom:12},brandName:{fontSize:31,fontWeight:"900",color:"#fff",letterSpacing:-1},tag:{fontSize:12,fontWeight:"800",color:"#ddd6fe",marginTop:2},brandSub:{fontSize:13,color:"#fff",marginTop:14,opacity:.9},form:{maxWidth:460,width:"100%",alignSelf:"center"},kicker:{fontSize:10,fontWeight:"900",letterSpacing:1.6,color:"#a78bfa"},title:{fontSize:28,fontWeight:"900",color:colors.text,marginTop:5},sub:{fontSize:13,color:colors.textSecondary,marginBottom:18},input:{height:52,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,paddingHorizontal:15,color:colors.text,marginBottom:10},error:{color:colors.danger,fontSize:12,fontWeight:"700",marginBottom:10},primary:{height:52,borderRadius:14,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:10},primaryText:{color:"#fff",fontWeight:"900",fontSize:15},divider:{flexDirection:"row",alignItems:"center",gap:10,marginVertical:18},line:{flex:1,height:1,backgroundColor:colors.border},or:{fontSize:11,color:colors.textMuted},social:{height:50,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:10},google:{fontSize:18,fontWeight:"900",color:"#4285F4"},socialText:{fontSize:14,fontWeight:"800",color:colors.text},signup:{textAlign:"center",color:colors.textSecondary,fontSize:13,marginTop:20}
});