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
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { login } from "../../lib/api";
import { appReturnUrl, buildGoogleAuthUrl, parseAuthCallback } from "../../lib/googleAuth";
import { buildFacebookAuthUrl, FACEBOOK_APP_ID } from "../../lib/facebookAuth";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [facebookBusy, setFacebookBusy] = useState(false);

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

  async function googleSignIn() {
    setGoogleBusy(true);
    setError("");
    try {
      const returnUrl = appReturnUrl();
      const result = await WebBrowser.openAuthSessionAsync(buildGoogleAuthUrl(), returnUrl);
      if (result.type === "success") {
        const cb = parseAuthCallback(result.url);
        if (cb?.token) {
          await SecureStore.setItemAsync("token", cb.token);
          router.replace("/(tabs)");
        } else if (cb?.error) {
          setError(cb.error);
        }
      }
      // ถ้าแอปถูกเปิดใหม่ (cold start) token จะถูกจัดการเองที่ _layout.tsx
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function facebookSignIn() {
    setFacebookBusy(true);
    setError("");
    try {
      const returnUrl = appReturnUrl();
      const result = await WebBrowser.openAuthSessionAsync(buildFacebookAuthUrl(), returnUrl);
      if (result.type === "success") {
        const cb = parseAuthCallback(result.url);
        if (cb?.token) {
          await SecureStore.setItemAsync("token", cb.token);
          router.replace("/(tabs)");
        } else if (cb?.error) {
          setError(cb.error);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ");
    } finally {
      setFacebookBusy(false);
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

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>หรือ</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={busy || googleBusy || facebookBusy}
          onPress={googleSignIn}
          style={({ pressed }) => [
            styles.googleButton,
            (pressed || busy || googleBusy || facebookBusy) && styles.buttonDimmed,
          ]}
        >
          <View style={styles.googleBadge}>
            <Text style={styles.googleBadgeText}>G</Text>
          </View>
          <Text style={styles.googleText}>เข้าสู่ระบบด้วย Google</Text>
        </Pressable>

        {FACEBOOK_APP_ID ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy || googleBusy || facebookBusy}
            onPress={facebookSignIn}
            style={({ pressed }) => [
              styles.facebookButton,
              (pressed || busy || googleBusy || facebookBusy) && styles.buttonDimmed,
            ]}
          >
            <View style={styles.facebookBadge}>
              <Text style={styles.facebookBadgeText}>f</Text>
            </View>
            <Text style={styles.facebookText}>เข้าสู่ระบบด้วย Facebook</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/(auth)/register")}
          style={styles.link}
        >
          <Text style={styles.linkText}>ยังไม่มีบัญชี? สมัครสมาชิก</Text>
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
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#cbd6d1" },
  dividerText: { color: "#64748b", fontSize: 13 },
  googleButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd6d1",
  },
  googleBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#4285F4",
    alignItems: "center",
    justifyContent: "center",
  },
  googleBadgeText: { color: "#fff", fontSize: 13, fontWeight: "700", lineHeight: 15 },
  googleText: { color: "#17231f", fontSize: 16, fontWeight: "600" },
  facebookButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd6d1",
  },
  facebookBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#1877F2",
    alignItems: "center",
    justifyContent: "center",
  },
  facebookBadgeText: { color: "#fff", fontSize: 14, fontWeight: "700", lineHeight: 15 },
  facebookText: { color: "#17231f", fontSize: 16, fontWeight: "600" },
  link: { alignItems: "center", marginTop: 8 },
  linkText: { color: "#147d64", fontSize: 14, fontWeight: "600" },
});
