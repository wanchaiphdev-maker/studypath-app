import { createContext,useContext,useState } from "react";
const Ctx=createContext<any>(null);
export const DEFAULT_COLOR="#7c3aed";
export const ThemeProvider=({children}:any)=>{const [color,setColor]=useState(DEFAULT_COLOR);return <Ctx.Provider value={{color,setColor}}>{children}</Ctx.Provider>};
export const useTheme=()=>useContext(Ctx);
export const colors={
 accent:"#7c3aed",accent2:"#4f46e5",background:"#0a0b16",surface:"#121426",surfaceAlt:"#1b1e33",
 border:"#292d49",track:"#292d49",text:"#f7f7ff",textSecondary:"#b8bbd2",textMuted:"#7e829d",
 danger:"#ef5b6f",success:"#34d399",warning:"#f59e0b",
 gradient:["#7c3aed","#4f46e5","#2563eb"],gradientWarm:["#a855f7","#7c3aed","#4f46e5"]
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
