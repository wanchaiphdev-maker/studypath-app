import { useEffect, useState } from "react";
import { View, Text, FlatList } from "react-native";
import { api } from "../../lib/api"; import { useTheme } from "../../lib/theme";

export default function Dashboard() {
  const { color } = useTheme();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api("/sales/summary?by=month").then(setRows); }, []);
  const totalPV = rows.reduce((a, r) => a + Number(r.pv), 0);
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  return (
    <View style={{ padding: 16 }}>
      <View style={{ backgroundColor: color, borderRadius: 16, padding: 20 }}>
        <Text style={{ color: "#fff" }}>รายได้สะสม</Text>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>฿{total.toLocaleString()}</Text>
        <Text style={{ color: "#fff" }}>{totalPV.toLocaleString()} PV</Text>
      </View>
      <FlatList data={rows} keyExtractor={r => r.period}
        renderItem={({ item }) => (
          <Text>{new Date(item.period).toLocaleDateString("th-TH", { month: "long", year: "numeric" })}: ฿{Number(item.amount).toLocaleString()} / {Number(item.pv)} PV</Text>)} />
    </View>);
}