import { createContext, useContext, useState } from "react";
const Ctx = createContext<any>(null);
export const ThemeProvider = ({ children }: any) => {
  const [color, setColor] = useState("#2563eb");
  return <Ctx.Provider value={{ color, setColor }}>{children}</Ctx.Provider>;
};
export const useTheme = () => useContext(Ctx);