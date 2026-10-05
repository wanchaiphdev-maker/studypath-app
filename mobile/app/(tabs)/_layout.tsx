import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, colors, spacing } from "../../lib/theme";

export default function TabsLayout() {
  const { color } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "ภาพรวม",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "สินค้า",
          tabBarIcon: ({ color, size }) => <Ionicons name="pricetag-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: "ทีม",
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "แชท",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "เพิ่มเติม",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal-circle-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
