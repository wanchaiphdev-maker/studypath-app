import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";

type Person = { id: string; name: string; themeColor: string };

type Room = {
  id: string;
  type: "DIRECT" | "GROUP" | string;
  group: { id: string; name: string } | null;
  members: string[];
  membersInfo?: Person[];
  lastMessage: {
    text: string;
    createdAt: string;
    sender: { id: string; name: string };
  } | null;
};

function roomTitle(room: Room, myId: string) {
  if (room.type === "GROUP") return room.group?.name ?? "ห้องกลุ่ม";
  const other = room.membersInfo?.find(person => person.id !== myId);
  return other?.name ?? "ห้องสนทนา";
}

function formatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatScreen() {
  const { color } = useTheme();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [myId, setMyId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roomList, me] = await Promise.all([api<Room[]>("/chat/rooms"), api<Person>("/me")]);
      setRooms(roomList);
      setMyId(me.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดห้องแชทไม่สำเร็จ");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // เลื่อนไป microtask: กันการ setState แบบซิงโครนัสใน effect (react-hooks/set-state-in-effect)
    Promise.resolve().then(load);
  }, [load]);

  const openMembers = useCallback(async () => {
    try {
      setMembers(await api<Person[]>("/team/members"));
      setPickerOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดรายชื่อไม่สำเร็จ");
    }
  }, []);

  const startDirect = useCallback(
    async (person: Person) => {
      if (starting) return;
      setStarting(true);
      try {
        const room = await api<Room>("/chat/rooms", {
          method: "POST",
          body: JSON.stringify({ type: "DIRECT", userId: person.id }),
        });
        setPickerOpen(false);
        router.push({ pathname: "/chat/[id]", params: { id: room.id, title: person.name } });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "เปิดห้องสนทนาไม่สำเร็จ");
      } finally {
        setStarting(false);
      }
    },
    [starting],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>แชท</Text>
        <Pressable accessibilityRole="button" onPress={() => void openMembers()} style={styles.addBtn}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rooms}
        keyExtractor={room => room.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={color}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>ยังไม่มีห้องสนทนา{"\n"}กดปุ่ม + เพื่อเริ่มคุยกับสมาชิก</Text>
        }
        renderItem={({ item }) => {
          const title = roomTitle(item, myId);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/chat/[id]", params: { id: item.id, title } })
              }
              style={({ pressed }) => [styles.roomRow, pressed && styles.roomPressed]}
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: item.type === "GROUP" ? color : "#147d64" },
                ]}
              >
                <Ionicons
                  name={item.type === "GROUP" ? "people" : "person"}
                  size={20}
                  color="#fff"
                />
              </View>
              <View style={styles.roomMain}>
                <View style={styles.roomTop}>
                  <Text style={styles.roomName} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.roomTime}>{formatTime(item.lastMessage?.createdAt)}</Text>
                </View>
                <Text style={styles.roomPreview} numberOfLines={1}>
                  {item.lastMessage
                    ? `${item.lastMessage.sender.id === myId ? "คุณ: " : `${item.lastMessage.sender.name}: `}${item.lastMessage.text}`
                    : "ยังไม่มีข้อความ"}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>เลือกสมาชิก</Text>
              <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)}>
                <Ionicons name="close" size={24} color="#3d4f49" />
              </Pressable>
            </View>
            <FlatList
              data={members.filter(person => person.id !== myId)}
              keyExtractor={person => person.id}
              ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีสมาชิกให้เลือก</Text>}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={starting}
                  onPress={() => void startDirect(item)}
                  style={({ pressed }) => [styles.memberRow, pressed && styles.roomPressed]}
                >
                  <View style={[styles.avatar, { backgroundColor: item.themeColor }]}>
                    <Text style={styles.avatarText}>{item.name.trim().charAt(0)}</Text>
                  </View>
                  <Text style={styles.memberName}>{item.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color="#8fa39c" />
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: "700", color: "#17231f" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#147d64",
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: "#b42318", paddingHorizontal: 16, marginBottom: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { color: "#6b7c76", textAlign: "center", paddingVertical: 32, lineHeight: 22 },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e3eae7",
    padding: 12,
    marginBottom: 8,
  },
  roomPressed: { opacity: 0.6 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  roomMain: { flex: 1, marginLeft: 12 },
  roomTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  roomName: { fontSize: 15, fontWeight: "600", color: "#17231f", flex: 1, marginRight: 8 },
  roomTime: { fontSize: 11, color: "#8fa39c" },
  roomPreview: { fontSize: 13, color: "#6b7c76", marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#17231f" },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  memberName: { flex: 1, marginLeft: 12, fontSize: 15, color: "#17231f" },
});
