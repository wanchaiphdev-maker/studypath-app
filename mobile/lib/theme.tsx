import { createContext,useContext,useState } from "react";
const Ctx=createContext<any>(null);
export const DEFAULT_COLOR="#7c3aed";
export const ThemeProvider=({children}:any)=>{const [color,setColor]=useState(DEFAULT_COLOR);return <Ctx.Provider value={{color,setColor}}>{children}</Ctx.Provider>};
export const useTheme=()=>useContext(Ctx);
export const colors={
 accent:"#6d28d9",accent2:"#4338ca",background:"#ffffff",surface:"#ffffff",surfaceAlt:"#f4f5f9",
 border:"#e2e5ef",track:"#e2e5ef",text:"#111827",textSecondary:"#4b5563",textMuted:"#6b7280",
 danger:"#dc2626",success:"#059669",warning:"#b45309",
 gradient:["#6d28d9","#4338ca","#1d4ed8"],gradientWarm:["#9333ea","#6d28d9","#4338ca"],
 // กล่องโค้ดคงโทนเข้มไว้เหมือนโปรแกรมแก้โค้ดจริง ตัดกับพื้นขาวได้ชัด
 codeBg:"#0d1117",codeBar:"#161b22",codeBorder:"#d0d7de",codeText:"#e6edf3",codeMuted:"#8b949e"
};
export const spacing={xs:4,sm:8,md:12,lg:16,xl:20,xxl:24,xxxl:32};
export const radius={sm:8,md:12,lg:16,xl:22,full:999};
export const shadow={card:{shadowColor:"#000",shadowOffset:{width:0,height:8},shadowOpacity:.22,shadowRadius:20,elevation:4},raised:{shadowColor:"#7c3aed",shadowOffset:{width:0,height:8},shadowOpacity:.28,shadowRadius:18,elevation:6}};
export const font={
 h1:{fontSize:29,fontWeight:"900" as const,color:colors.text,letterSpacing:-.6},
 h2:{fontSize:23,fontWeight:"900" as const,color:colors.text},
 h3:{fontSize:18,fontWeight:"800" as const,color:colors.text},
 title:{fontSize:15,fontWeight:"800" as const,color:colors.text},
 body:{fontSize:14,fontWeight:"400" as const,color:colors.textSecondary,lineHeight:21},
 label:{fontSize:13,fontWeight:"700" as const,color:colors.textSecondary},
 caption:{fontSize:11,fontWeight:"600" as const,color:colors.textMuted}
};
