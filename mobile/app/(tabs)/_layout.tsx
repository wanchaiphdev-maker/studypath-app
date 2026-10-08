import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";

const tabs: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  index: { icon: "home-outline", label: "วันนี้" },
  subjects: { icon: "library-outline", label: "วิชา" },
  tutor: { icon: "sparkles-outline", label: "AI Tutor" },
  review: { icon: "refresh-outline", label: "ทบทวน" },
  more: { icon: "person-outline", label: "โปรไฟล์" },
};

export default function TabsLayout() {
  return <Tabs screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.textMuted,
    tabBarLabel: tabs[route.name]?.label || route.name,
    tabBarIcon: ({ color, size }) => <Ionicons name={tabs[route.name]?.icon || "ellipse-outline"} size={size} color={color} />,
  })}>
    <Tabs.Screen name="index" /><Tabs.Screen name="subjects" /><Tabs.Screen name="tutor" /><Tabs.Screen name="review" /><Tabs.Screen name="more" />
  </Tabs>;
}
