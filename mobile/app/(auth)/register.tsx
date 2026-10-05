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
import { register } from "../../lib/api";

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
        <Text style={styles.eyebrow}>AMWAY TEAM</Text>
        <Text style={styles.title}>สมัครสมาชิก</Text>
        <TextInput
          autoCapitalize="words"
          onChangeText={setName}
          placeholder="ชื่อ-นามสกุล"
          style={styles.input}
          value={name}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="อีเมล"
          style={styles.input}
          value={email}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPassword}
          placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
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
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={confirm}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
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
  screen: { flex: 1, justifyContent: "center", backgroundColor: "#f4f7f5", padding: 24 },
  form: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 14 },
  eyebrow: { color: "#147d64", fontSize: 12, fontWeight: "700" },
  title: { color: "#17231f", fontSize: 28, fontWeight: "700", marginBottom: 10 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#cbd6d1",
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    color: "#17231f",
  },
  error: { color: "#b42318" },
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#147d64",
    marginTop: 4,
  },
  buttonDimmed: { opacity: 0.55 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  link: { alignItems: "center", marginTop: 6 },
  linkText: { color: "#147d64", fontSize: 14, fontWeight: "600" },
});
