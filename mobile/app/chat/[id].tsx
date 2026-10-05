import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import type { Socket } from "socket.io-client";
import { api } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { useTheme } from "../../lib/theme";

type Message = {
  id: string;
  roomId: string;
  senderId: string;
  text: string;
  createdAt: string;
  sender: { id: string; name: string; themeColor: string };
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatThread() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { color } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [myId, setMyId] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    const roomId = String(id);

    async function setup() {
      try {
        const [history, me] = await Promise.all([
          api<Message[]>(`/chat/rooms/${encodeURIComponent(roomId)}/messages`),
          api<{ id: string }>("/me"),
        ]);
        if (!active) return;
        setMessages(history);
        setMyId(me.id);

        const socket = await getSocket();
        if (!active) return;
        socketRef.current = socket;

        const join = () => socket.emit("join", roomId);
        const onMessage = (message: Message) => {
          if (message.roomId !== roomId) return;
          setMessages(current => (current.some(item => item.id === message.id) ? current : [...current, message]));
        };

        socket.on("connect", join);
        socket.on("msg", onMessage);
        if (socket.connected) join();

        cleanup = () => {
          socket.off("connect", join);
          socket.off("msg", onMessage);
        };
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "เปิดห้องสนทนาไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }

    void setup();
    return () => {
      active = false;
      cleanup?.();
    };
  }, [id]);

  const send = useCallback(() => {
    const value = text.trim();
    const socket = socketRef.current;
    if (!value || !socket) return;
    socket.emit("msg", { roomId: String(id), text: value });
    setText("");
  }, [id, text]);

  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#17231f" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {typeof title === "string" && title ? title : "ห้องสนทนา"}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีข้อความ{"\n"}เริ่มพูดคุยได้เลย</Text>}
        renderItem={({ item }) => {
          const mine = item.senderId === myId;
          return (
            <View style={[styles.bubbleRow, mine ? styles.bubbleRight : styles.bubbleLeft]}>
              {!mine ? (
                <View style={[styles.avatar, { backgroundColor: item.sender.themeColor }]}>
                  <Text style={styles.avatarText}>{item.sender.name.trim().charAt(0)}</Text>
                </View>
              ) : null}
              <View style={[styles.bubble, mine ? { backgroundColor: color } : styles.bubbleOther]}>
                {!mine ? <Text style={styles.sender}>{item.sender.name}</Text> : null}
                <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{item.text}</Text>
                <Text style={[styles.time, mine && { color: "#ffffffb3" }]}>{formatTime(item.createdAt)}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="พิมพ์ข้อความ..."
          style={styles.input}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          disabled={!text.trim()}
          onPress={send}
          style={[styles.sendBtn, { backgroundColor: color, opacity: text.trim() ? 1 : 0.45 }]}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e3eae7",
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: "#17231f", textAlign: "center" },
  error: { color: "#b42318", paddingHorizontal: 16, paddingTop: 8 },
  list: { padding: 16, paddingBottom: 8 },
  empty: { color: "#6b7c76", textAlign: "center", paddingVertical: 40, lineHeight: 22 },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10, gap: 8 },
  bubbleLeft: { justifyContent: "flex-start" },
  bubbleRight: { justifyContent: "flex-end" },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  bubble: { maxWidth: "78%", borderRadius: 16, padding: 10, paddingBottom: 6 },
  bubbleOther: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e3eae7" },
  sender: { fontSize: 12, fontWeight: "700", color: "#3d4f49", marginBottom: 2 },
  bubbleText: { fontSize: 15, color: "#17231f", lineHeight: 21 },
  time: { fontSize: 10, color: "#8fa39c", alignSelf: "flex-end", marginTop: 3 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e3eae7",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#cbd6d1",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: "#f8faf9",
    color: "#17231f",
    fontSize: 15,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
