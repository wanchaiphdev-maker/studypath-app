import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { register } from "../../lib/api";
import { colors, spacing, radius, font, shadow } from "../../lib/theme";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (password !== confirm) throw new Error("รหัสผ่านไม่ตรงกัน");
      await register(name.trim(), email.trim(), password);
      const token = await SecureStore.getItemAsync("token");
      if (!token) throw new Error("เข้าสู่ระบบไม่สำเร็จ");
      router.replace("/(tabs)");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "สมัครสมาชิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const ready = name.trim() && email.trim() && password.length >= 8 && confirm;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={styles.form}>
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons name="person-add" size={28} color="#fff" />
          </View>
          <Text style={styles.brandName}>StudyPath</Text>
        </View>

        <Text style={styles.title}>สมัครสมาชิก</Text>

        <TextInput
          autoCapitalize="words"
          onChangeText={setName}
          placeholder="ชื่อ-นามสกุล"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={name}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="อีเมล"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={email}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPassword}
          placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setConfirm}
          onSubmitEditing={submit}
          placeholder="ยืนยันรหัสผ่าน"
          placeholderTextColor={colors.textMuted}
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={confirm}
        />
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !ready}
          onPress={submit}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy || !ready) && styles.buttonDimmed,
          ]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>สมัครสมาชิก</Text>}
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.replace("/(auth)/login")} style={styles.link}>
          <Text style={styles.linkText}>มีบัญชีอยู่แล้ว? เข้าสู่ระบบ</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", backgroundColor: colors.background, padding: spacing.xl },
  form: { width: "100%", maxWidth: 420, alignSelf: "center" },
  brand: { alignItems: "center", marginBottom: spacing.xxl },
  brandIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    ...shadow.raised,
  },
  brandName: { fontSize: 24, fontWeight: "700", color: colors.text },
  brandTag: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  title: { ...font.h1, marginBottom: spacing.lg },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.text,
    marginBottom: spacing.md,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fdf3f2",
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, fontSize: 13, flex: 1 },
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    marginTop: spacing.xs,
  },
  buttonDimmed: { opacity: 0.55 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  link: { alignItems: "center", marginTop: spacing.sm },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
});
