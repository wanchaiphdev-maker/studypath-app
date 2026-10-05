import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, shadow, spacing } from "./theme";

/** การ์ดพื้นผิวขาว — โค้งมุน เงาเบา */
export function Card({ children, style, gap }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[styles.card, gap ? { gap } : null, style]}>{children}</View>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** ปุ่มหลัก/รอง/ghost/อันตราย */
export function Button({
  children,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isGhost = variant === "ghost";
  const bg = isPrimary ? "PRIMARY" : isDanger ? colors.danger : "transparent";
  const fg = isPrimary || isDanger ? "#fff" : isGhost ? colors.textSecondary : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled || loading ? 0.5 : pressed ? 0.85 : 1 },
        variant === "secondary" && { borderWidth: 1, borderColor: colors.border },
        isGhost && { paddingHorizontal: spacing.md },
        style,
      ]}
    >
      {loading ? (
        <Text style={[styles.buttonText, { color: fg }]}>กำลังโหลด...</Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{children}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** หัวข้อส่วน + ปุ่มเสริม (เช่น "ดูทั้งหมด") */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** รูปโปรไฟล์วงกลมตัวอักษรย่อ */
export function Avatar({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.4, fontWeight: "700" }}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

/** การ์ดสถิติ — ค่า + หัวข้อ + คำอธิบายเสริม */
export function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

/** ป้ายชื่อเล็กแบบ pill */
export function Pill({ text, color }: { text: string; color?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: (color ?? colors.accent) + "1a" }]}>
      <Text style={[styles.pillText, { color: color ?? colors.accent }]}>{text}</Text>
    </View>
  );
}

/** สถานะว่างเปล่า */
export function EmptyState({ icon, message, sub }: { icon: keyof typeof Ionicons.glyphMap; message: string; sub?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.textMuted} />
      <Text style={styles.emptyMessage}>{message}</Text>
      {sub ? <Text style={styles.emptySub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sectionTitle: { ...font.h3 },
  sectionAction: { fontSize: 13, fontWeight: "600", color: colors.accent },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  statLabel: { ...font.caption },
  statValue: { fontSize: 24, fontWeight: "700", marginTop: spacing.xs },
  statSub: { ...font.caption, marginTop: 2 },
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  pillText: { fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyMessage: { ...font.body, color: colors.textSecondary, textAlign: "center" },
  emptySub: { ...font.caption, textAlign: "center" },
});
