import { Stack } from "expo-router";
import { ThemeProvider } from "../lib/theme";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Stack initialRouteName="(auth)" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="call/[room]" />
      </Stack>
    </ThemeProvider>
  );
}
