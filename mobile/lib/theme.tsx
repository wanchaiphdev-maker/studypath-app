import { createContext, useContext, useState } from "react";

const Ctx = createContext<any>(null);

export const DEFAULT_COLOR = "#2563eb";

export const ThemeProvider = ({ children }: any) => {
  const [color, setColor] = useState(DEFAULT_COLOR);
  return <Ctx.Provider value={{ color, setColor }}>{children}</Ctx.Provider>;
};

export const useTheme = () => useContext(Ctx);

/** ชุดสีของแอป — ใช้ร่วมกับสีธีมของผู้ใช้ (color จาก useTheme) */
export const colors = {
  accent: "#147d64",
  background: "#f6f8f7",
  surface: "#ffffff",
  surfaceAlt: "#f0f4f2",
  border: "#e4eae8",
  text: "#1a2420",
  textSecondary: "#5c6b66",
  textMuted: "#93a19c",
  danger: "#c0392b",
  success: "#147d64",
  warning: "#b7791f",
};

/** ระยะห่างแบบ 8px grid */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

/** มุมโค้ง */
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 };

/** เงา */
export const shadow = {
  card: {
    shadowColor: "#17231f",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  raised: {
    shadowColor: "#17231f",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 5,
  },
};

/** ตัวอักษร */
export const font = {
  h1: { fontSize: 28, fontWeight: "700" as const, color: colors.text },
  h2: { fontSize: 22, fontWeight: "700" as const, color: colors.text },
  h3: { fontSize: 18, fontWeight: "700" as const, color: colors.text },
  title: { fontSize: 16, fontWeight: "600" as const, color: colors.text },
  body: { fontSize: 14, fontWeight: "400" as const, color: colors.text },
  label: { fontSize: 13, fontWeight: "500" as const, color: colors.textSecondary },
  caption: { fontSize: 12, fontWeight: "400" as const, color: colors.textMuted },
};
