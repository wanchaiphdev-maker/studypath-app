import {Tabs} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {colors,radius} from "../../lib/theme";
const tabs:any={index:["home","วันนี้"],subjects:["library","วิชา"],tutor:["sparkles","AI"],review:["repeat","ทบทวน"],more:["person","โปรไฟล์"]};
export default function TabsLayout(){
 return <Tabs screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:"#fff",tabBarInactiveTintColor:colors.textMuted,tabBarLabel:tabs[route.name]?.[1]||route.name,tabBarLabelStyle:{fontSize:10,fontWeight:"800",marginBottom:3},tabBarStyle:{position:"absolute",left:12,right:12,bottom:12,height:68,borderRadius:radius.xl,borderTopWidth:1,borderWidth:1,borderColor:colors.border,backgroundColor:"#121426ee",paddingTop:8,paddingBottom:8,shadowColor:"#000",shadowOpacity:.3,shadowRadius:20,elevation:10},tabBarIcon:({color,size,focused})=><Ionicons name={(tabs[route.name]?.[0]||"ellipse")+"-outline" as any} size={focused?23:21} color={color}/>})}>
 <Tabs.Screen name="index"/><Tabs.Screen name="subjects"/><Tabs.Screen name="tutor"/><Tabs.Screen name="review"/><Tabs.Screen name="more"/>
 </Tabs>
}