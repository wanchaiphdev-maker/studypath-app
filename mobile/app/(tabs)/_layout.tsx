import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, colors, spacing } from "../../lib/theme";

const HOME_BLUE = "#4A90D9";

const TAB_CONFIG: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  team: { icon: "people-outline", label: "ทีม" },
  chat: { icon: "chatbubbles-outline", label: "แชท" },
  index: { icon: "home", label: "หน้าหลัก" },
  products: { icon: "pricetag-outline", label: "สินค้า" },
  more: { icon: "person-circle-outline", label: "โปรไฟล์" },
};

function CustomTabBar({ state, navigation }: any) {
  const { color } = useTheme();
  return (
    <View style={styles.tabBar}>
      {state.routes.map((route: any, index: number) => {
        const isFocused = state.index === index;
        const config = TAB_CONFIG[route.name] ?? { icon: "ellipse-outline" as const, label: route.name };
        const isHome = route.name === "index";

        if (isHome) {
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel="หน้าหลัก"
              onPress={() => navigation.navigate(route.name)}
              style={styles.centerWrap}
            >
              <View style={[styles.centerButton, isFocused && styles.centerButtonActive]}>
                <Ionicons name="home" size={32} color="#fff" />
              </View>
              <Text style={[styles.centerLabel, { color: isFocused ? HOME_BLUE : colors.textMuted }]}>
                หน้าหลัก
              </Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityLabel={config.label}
            onPress={() => navigation.navigate(route.name)}
            style={styles.tab}
          >
            <Ionicons name={config.icon} size={26} color={isFocused ? color : colors.textMuted} />
            <Text style={[styles.tabLabel, { color: isFocused ? color : colors.textMuted }]}>
              {config.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="team" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="products" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    height: 84,
    paddingBottom: 10,
    paddingHorizontal: spacing.sm,
    shadowColor: "#17231f",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 6,
    gap: 3,
  },
  tabLabel: { fontSize: 12, fontWeight: "600" },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 6,
  },
  centerButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: HOME_BLUE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: HOME_BLUE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    borderWidth: 4,
    borderColor: colors.surface,
  },
  centerButtonActive: {
    transform: [{ scale: 1.1 }],
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  centerLabel: { fontSize: 12, fontWeight: "700" },
});
