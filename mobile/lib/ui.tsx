import { ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { colors, font, radius, shadow, spacing } from "./theme";

export function Card({children,style}: {children:ReactNode;style?:ViewStyle}) {
  return <View style={[styles.card,style]}>{children}</View>;
}
export function GlowCard({children,style,colors:gradient=colors.gradient}: {children:ReactNode;style?:ViewStyle;colors?:string[]}) {
  return <LinearGradient colors={gradient as any} start={{x:0,y:0}} end={{x:1,y:1}} style={[styles.glow,style]}>{children}</LinearGradient>;
}
export function IconTile({icon,color=colors.accent,size=46}: {icon:keyof typeof Ionicons.glyphMap;color?:string;size?:number}) {
  return <View style={{width:size,height:size,borderRadius:size*0.32,backgroundColor:color+"22",alignItems:"center",justifyContent:"center"}}><Ionicons name={icon} size={size*0.48} color={color}/></View>;
}
export function ProgressBar({value,color=colors.accent}: {value:number;color?:string}) {
  return <View style={styles.track}><View style={[styles.fill,{width:Math.max(2,Math.min(100,value))+"%" as any,backgroundColor:color}]}/></View>;
}
export function SectionHeader({title,action,onAction}:{title:string;action?:string;onAction?:()=>void}) {
  return <View style={styles.section}><Text style={font.h3}>{title}</Text>{action?<Pressable onPress={onAction}><Text style={styles.action}>{action}</Text></Pressable>:null}</View>;
}
export function Pill({text,color=colors.accent}:{text:string;color?:string}) {
  return <View style={[styles.pill,{backgroundColor:color+"20"}]}><Text style={[styles.pillText,{color}]}>{text}</Text></View>;
}
export function Button({children,onPress,icon,variant="primary",loading=false,disabled=false}:{children:ReactNode;onPress?:()=>void;icon?:keyof typeof Ionicons.glyphMap;variant?:"primary"|"secondary"|"ghost"|"danger";loading?:boolean;disabled?:boolean}) {
  const primary=variant==="primary"; const danger=variant==="danger"; const ghost=variant==="ghost";
  const off=!!disabled&&!loading;
  return <Pressable onPress={onPress} disabled={loading||disabled} style={({pressed})=>[styles.button,primary?styles.primary:danger?styles.danger:ghost?styles.ghost:styles.secondary,(pressed||off)&&{opacity:off?.45:.82}]}>{icon?<Ionicons name={icon} size={18} color={primary?"#fff":colors.text}/>:null}<Text style={[styles.buttonText,{color:primary?"#fff":colors.text}]}>{loading?"กำลังโหลด...":children}</Text></Pressable>;
}
export function StatCard({value,label,icon,color=colors.accent}:{value:string;label:string;icon:keyof typeof Ionicons.glyphMap;color?:string}) {
  return <Card style={styles.stat}><IconTile icon={icon} color={color} size={38}/><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></Card>;
}
export function Avatar({name,size=44}:{name:string;size?:number}) {
  return <LinearGradient colors={colors.gradient as any} style={{width:size,height:size,borderRadius:size/2,alignItems:"center",justifyContent:"center"}}><Text style={{color:"#fff",fontSize:size*.38,fontWeight:"800"}}>{name.trim().charAt(0).toUpperCase()}</Text></LinearGradient>;
}
const styles=StyleSheet.create({
 card:{backgroundColor:colors.surface,borderRadius:radius.lg,borderWidth:1,borderColor:colors.border,padding:spacing.lg,...shadow.card},
 glow:{borderRadius:radius.xl,padding:spacing.lg,overflow:"hidden"},
 track:{height:7,borderRadius:99,backgroundColor:colors.track,overflow:"hidden"},
 fill:{height:7,borderRadius:99},
 section:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:spacing.md},
 action:{color:colors.accent,fontSize:13,fontWeight:"700"},
 pill:{alignSelf:"flex-start",paddingHorizontal:10,paddingVertical:5,borderRadius:99},
 pillText:{fontSize:11,fontWeight:"800"},
 button:{minHeight:48,borderRadius:radius.md,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,paddingHorizontal:18},
 primary:{backgroundColor:colors.accent},danger:{backgroundColor:colors.danger},ghost:{backgroundColor:"transparent"},
 secondary:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
 buttonText:{fontSize:14,fontWeight:"800"},
 stat:{flex:1,minWidth:90,padding:12},
 statValue:{fontSize:21,fontWeight:"900",color:colors.text,marginTop:7},
 statLabel:{fontSize:11,color:colors.textMuted,marginTop:2}
});
