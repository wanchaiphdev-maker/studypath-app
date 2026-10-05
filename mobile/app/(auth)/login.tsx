import { useEffect, useState } from "react";
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
import { login } from "../../lib/api";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync("token")
      .then(token => token && router.replace("/(tabs)"))
      .catch(() => undefined);
  }, []);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={styles.form}>
        <Text style={styles.eyebrow}>AMWAY TEAM</Text>
        <Text style={styles.title}>เข้าสู่ระบบ</Text>
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
          autoComplete="current-password"
          onChangeText={setPassword}
          onSubmitEditing={submit}
          placeholder="รหัสผ่าน"
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !email || !password}
          onPress={submit}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy || !email || !password) && styles.buttonDimmed,
          ]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>เข้าสู่ระบบ</Text>}
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
});
