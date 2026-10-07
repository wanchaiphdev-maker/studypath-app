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
import { Ionicons } from "@expo/vector-icons";
import { login } from "../../lib/api";
import { appReturnUrl, buildGoogleAuthUrl, parseAuthCallback } from "../../lib/googleAuth";
import { buildFacebookAuthUrl, FACEBOOK_APP_ID } from "../../lib/facebookAuth";
import { colors, spacing, radius, font, shadow } from "../../lib/theme";

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

  const anyBusy = busy || googleBusy || facebookBusy;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={styles.form}>
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons name="people" size={28} color="#fff" />
          </View>
          <Text style={styles.brandName}>StudyPath</Text>
          <Text style={styles.brandTag}>Personal Learning OS สำหรับมหาวิทยาลัย</Text>
        </View>

        <Text style={styles.title}>เข้าสู่ระบบ</Text>

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
          autoComplete="current-password"
          onChangeText={setPassword}
          onSubmitEditing={submit}
          placeholder="รหัสผ่าน"
          placeholderTextColor={colors.textMuted}
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={anyBusy || !email || !password}
          onPress={submit}
          style={({ pressed }) => [
            styles.button,
            (pressed || anyBusy || !email || !password) && styles.buttonDimmed,
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
          disabled={anyBusy}
          onPress={googleSignIn}
          style={({ pressed }) => [styles.socialButton, pressed && styles.buttonDimmed]}
        >
          {googleBusy ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <View style={[styles.socialBadge, { backgroundColor: "#4285F4" }]}>
                <Text style={styles.socialBadgeText}>G</Text>
              </View>
              <Text style={styles.socialText}>เข้าสู่ระบบด้วย Google</Text>
            </>
          )}
        </Pressable>

        {FACEBOOK_APP_ID ? (
          <Pressable
            accessibilityRole="button"
            disabled={anyBusy}
            onPress={facebookSignIn}
            style={({ pressed }) => [styles.socialButton, pressed && styles.buttonDimmed]}
          >
            {facebookBusy ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <View style={[styles.socialBadge, { backgroundColor: "#1877F2" }]}>
                  <Text style={styles.socialBadgeText}>f</Text>
                </View>
                <Text style={styles.socialText}>เข้าสู่ระบบด้วย Facebook</Text>
              </>
            )}
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
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: 13 },
  socialButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  socialBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  socialBadgeText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  socialText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  link: { alignItems: "center", marginTop: spacing.sm },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
});
