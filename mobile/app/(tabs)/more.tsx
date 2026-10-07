import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { api } from "../../lib/api";
import { closeSocket } from "../../lib/socket";
import { useTheme, colors, spacing, radius, font, shadow } from "../../lib/theme";
import { Avatar, Card, Pill, EmptyState } from "../../lib/ui";

type Me = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "LEADER" | "MEMBER";
  themeColor: string;
};

type NewsItem = { id: string; title: string; body: string; createdAt: string };
type EventItem = { id: string; title: string; description: string | null; location: string | null; startsAt: string };
type MeetingItem = { id: string; title: string; startsAt: string; hostId: string; groupId: string | null };
type CustomerItem = { id: string; name: string; phone: string | null; email: string | null; note: string | null };
type IncomeData = { personal: { amount: number; pv: number }; group: { amount: number; pv: number; downlineCount: number } };

const ROLE_LABEL: Record<Me["role"], string> = {
  ADMIN: "แอดมิน",
  LEADER: "หัวหน้าทีม",
  MEMBER: "สมาชิก",
};

const COLORS = ["#2563eb", "#147d64", "#7c3aed", "#db2777", "#ea580c", "#0891b2"];

const money = (value: number) => `฿${Number(value).toLocaleString("th-TH")}`;

export default function MoreScreen() {
  const { color, setColor } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [income, setIncome] = useState<IncomeData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [newsOpen, setNewsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [selectedNewsId, setSelectedNewsId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meData, newsData, eventsData, meetingsData, customersData, incomeData] = await Promise.all([
        api<Me>("/me"),
        api<NewsItem[]>("/news").catch(() => []),
        api<EventItem[]>("/events").catch(() => []),
        api<MeetingItem[]>("/meetings").catch(() => []),
        api<CustomerItem[]>("/customers").catch(() => []),
        api<IncomeData>("/team/income").catch(() => null),
      ]);
      setMe(meData);
      setNews(newsData);
      setEvents(eventsData);
      setMeetings(meetingsData);
      setCustomers(customersData);
      setIncome(incomeData);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดโปรไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const pickColor = useCallback(
    async (next: string) => {
      if (!me || saving || next === me.themeColor) return;
      const previous = me.themeColor;
      setColor(next);
      setMe({ ...me, themeColor: next });
      setSaving(true);
      try {
        await api("/me", { method: "PATCH", body: JSON.stringify({ themeColor: next }) });
      } catch (cause) {
        setColor(previous);
        setMe({ ...me, themeColor: previous });
        setError(cause instanceof Error ? cause.message : "บันทึกสีไม่สำเร็จ");
      } finally {
        setSaving(false);
      }
    },
    [me, setColor, saving],
  );

  const logout = useCallback(() => {
    Alert.alert("ออกจากระบบ", "ต้องการออกจากระบบใช่หรือไม่?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ออกจากระบบ",
        style: "destructive",
        onPress: async () => {
          closeSocket();
          await SecureStore.deleteItemAsync("token").catch(() => undefined);
          router.replace("/(auth)/login");
        },
      },
    ]);
  }, []);

  const createMeeting = useCallback(async () => {
    if (saving || !meetingTitle.trim() || !meetingDate.trim()) return;
    setSaving(true);
    try {
      const startsAt = new Date(meetingDate);
      if (!Number.isFinite(startsAt.getTime())) throw new Error("วันที่ไม่ถูกต้อง");
      await api("/meetings", {
        method: "POST",
        body: JSON.stringify({ title: meetingTitle, startsAt: startsAt.toISOString() }),
      });
      setMeetingOpen(false);
      setMeetingTitle("");
      setMeetingDate("");
      await load();
    } catch (cause) {
      Alert.alert("สร้างประชุมไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }, [meetingTitle, meetingDate, load, saving]);

  const createCustomer = useCallback(async () => {
    if (saving || !customerName.trim()) return;
    setSaving(true);
    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({ name: customerName, phone: customerPhone, note: customerNote }),
      });
      setCustomerOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerNote("");
      await load();
    } catch (cause) {
      Alert.alert("เพิ่มลูกค้าไม่สำเร็จ", cause instanceof Error ? cause.message : "ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }, [customerName, customerPhone, customerNote, load, saving]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* โปรไฟล์ */}
      {me ? (
        <View style={[styles.profile, { backgroundColor: color }]}>
          <Avatar name={me.name} color="#ffffff33" size={56} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{me.name}</Text>
            <Text style={styles.profileEmail}>{me.email}</Text>
            <View style={{ marginTop: 8 }}>
              <Pill text={ROLE_LABEL[me.role]} color="#fff" />
            </View>
          </View>
        </View>
      ) : null}

      {/* รายได้ของฉัน */}
      <Text style={styles.section}>รายได้ของฉัน</Text>
      {income ? (
        <Card style={styles.incomeCard}>
          <View style={styles.incomeRow}>
            <View style={styles.incomeItem}>
              <Text style={styles.incomeLabel}>ยอดส่วนตัว</Text>
              <Text style={[styles.incomeValue, { color }]}>{money(income.personal.amount)}</Text>
              <Text style={styles.incomeSub}>{Number(income.personal.pv).toLocaleString("th-TH")} PV</Text>
            </View>
            <View style={styles.incomeDivider} />
            <View style={styles.incomeItem}>
              <Text style={styles.incomeLabel}>ยอดทีมรวม</Text>
              <Text style={[styles.incomeValue, { color }]}>{money(income.group.amount)}</Text>
              <Text style={styles.incomeSub}>{Number(income.group.pv).toLocaleString("th-TH")} PV · {income.group.downlineCount} คน</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={font.body}>ยังไม่มีข้อมูลรายได้</Text>
        </Card>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* ตั้งค่า */}
      <Text style={styles.section}>ตั้งค่า</Text>
      <Card>
        <Text style={styles.settingLabel}>สีธีมของแอป</Text>
        <View style={styles.colorRow}>
          {COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityRole="button"
              accessibilityLabel={`เลือกสี ${swatch}`}
              disabled={saving}
              onPress={() => void pickColor(swatch)}
              style={[
                styles.swatch,
                { backgroundColor: swatch, borderColor: me?.themeColor === swatch ? colors.text : "#ffffff00" },
              ]}
            >
              {me?.themeColor === swatch ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
            </Pressable>
          ))}
        </View>
      </Card>

      {/* ข่าวสาร / โปรโมชั่น — เมนูย่อ กดเพื่อดูทีละอัน */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`ข่าวสารและโปรโมชั่น ${news.length} รายการ`}
        onPress={() => setNewsOpen((v) => !v)}
        style={styles.accHeader}
      >
        <View style={styles.accLeft}>
          <View style={[styles.accIcon, { backgroundColor: color + "1a" }]}>
            <Ionicons name="megaphone-outline" size={18} color={color} />
          </View>
          <View style={styles.accTextBox}>
            <Text style={styles.accTitle}>ข่าวสารและโปรโมชั่น</Text>
            <Text style={styles.accSub} numberOfLines={1}>
              {news.length === 0
                ? "ยังไม่มีข่าวสาร"
                : `${news.length} รายการ`}
            </Text>
          </View>
        </View>
        <Ionicons name={newsOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
      </Pressable>
      {newsOpen ? (
        news.length === 0 ? (
          <EmptyState icon="newspaper-outline" message="ยังไม่มีข่าวสาร" />
        ) : (
          <View style={styles.accBody}>
            {news.map((item, idx) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => setSelectedNewsId(selectedNewsId === item.id ? null : item.id)}
                style={styles.accRow}
              >
                <View style={styles.accRowTop}>
                  <View style={[styles.accDot, { backgroundColor: idx === 0 ? color : colors.border }]} />
                  <Text style={[styles.accRowTitle, selectedNewsId === item.id && { color }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Ionicons
                    name={selectedNewsId === item.id ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.textMuted}
                  />
                </View>
                {selectedNewsId === item.id ? (
                  <Text style={styles.accRowBody}>{item.body}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      {/* กิจกรรม — เมนูย่อ กดเพื่อดูทีละอัน */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`กิจกรรมที่กำลังจะมาถึง ${events.length} รายการ`}
        onPress={() => setEventsOpen((v) => !v)}
        style={styles.accHeader}
      >
        <View style={styles.accLeft}>
          <View style={[styles.accIcon, { backgroundColor: color + "1a" }]}>
            <Ionicons name="calendar-outline" size={18} color={color} />
          </View>
          <View style={styles.accTextBox}>
            <Text style={styles.accTitle}>กิจกรรมที่กำลังจะมาถึง</Text>
            <Text style={styles.accSub} numberOfLines={1}>
              {events.length === 0
                ? "ยังไม่มีกิจกรรม"
                : events[0]
                  ? new Date(events[0].startsAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
                  : `${events.length} รายการ`}
            </Text>
          </View>
        </View>
        <Ionicons name={eventsOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
      </Pressable>
      {eventsOpen ? (
        events.length === 0 ? (
          <EmptyState icon="calendar-outline" message="ยังไม่มีกิจกรรม" />
        ) : (
          <View style={styles.accBody}>
            {events.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => setSelectedEventId(selectedEventId === item.id ? null : item.id)}
                style={styles.accRow}
              >
                <View style={styles.accRowTop}>
                  <View style={[styles.accDot, { backgroundColor: color }]} />
                  <Text style={[styles.accRowTitle, selectedEventId === item.id && { color }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Ionicons
                    name={selectedEventId === item.id ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.textMuted}
                  />
                </View>
                {selectedEventId === item.id ? (
                  <View>
                    {item.description ? <Text style={styles.accRowBody}>{item.description}</Text> : null}
                    <View style={styles.accMetaRow}>
                      <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                      <Text style={styles.accMetaText}>
                        {new Date(item.startsAt).toLocaleDateString("th-TH", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}{" "}
                        {new Date(item.startsAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                    {item.location ? (
                      <View style={styles.accMetaRow}>
                        <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                        <Text style={styles.accMetaText}>{item.location}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      {/* นัดประชุม — เมนูย่อ */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`นัดประชุม ${meetings.length} รายการ`}
        onPress={() => setMeetingsOpen((v) => !v)}
        style={styles.accHeader}
      >
        <View style={styles.accLeft}>
          <View style={[styles.accIcon, { backgroundColor: color + "1a" }]}>
            <Ionicons name="videocam-outline" size={18} color={color} />
          </View>
          <View style={styles.accTextBox}>
            <Text style={styles.accTitle}>นัดประชุม</Text>
            <Text style={styles.accSub} numberOfLines={1}>
              {meetings.length === 0 ? "ยังไม่มีการนัดประชุม" : `${meetings.length} รายการ`}
            </Text>
          </View>
        </View>
        <View style={styles.accRight}>
          {me?.role !== "MEMBER" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="สร้างการนัดประชุม"
              onPress={() => setMeetingOpen(true)}
              hitSlop={8}
              style={styles.accAddBtn}
            >
              <Ionicons name="add" size={18} color={color} />
            </Pressable>
          ) : null}
          <Ionicons name={meetingsOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
        </View>
      </Pressable>
      {meetingsOpen ? (
        meetings.length === 0 ? (
          <EmptyState icon="videocam-outline" message="ยังไม่มีการนัดประชุม" />
        ) : (
          <View style={styles.accBody}>
            {meetings.map((item) => (
              <View key={item.id} style={styles.accRowStatic}>
                <View style={styles.accRowTop}>
                  <View style={[styles.accDot, { backgroundColor: color }]} />
                  <Text style={styles.accRowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
                <View style={styles.accMetaRow}>
                  <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.accMetaText}>
                    {new Date(item.startsAt).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}{" "}
                    {new Date(item.startsAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}

      {/* ลูกค้า — เมนูย่อ */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`ลูกค้า ${customers.length} รายการ`}
        onPress={() => setCustomersOpen((v) => !v)}
        style={styles.accHeader}
      >
        <View style={styles.accLeft}>
          <View style={[styles.accIcon, { backgroundColor: color + "1a" }]}>
            <Ionicons name="people-outline" size={18} color={color} />
          </View>
          <View style={styles.accTextBox}>
            <Text style={styles.accTitle}>ลูกค้า</Text>
            <Text style={styles.accSub} numberOfLines={1}>
              {customers.length === 0 ? "ยังไม่มีลูกค้า" : `${customers.length} คน`}
            </Text>
          </View>
        </View>
        <View style={styles.accRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="เพิ่มลูกค้า"
            onPress={() => setCustomerOpen(true)}
            hitSlop={8}
            style={styles.accAddBtn}
          >
            <Ionicons name="add" size={18} color={color} />
          </Pressable>
          <Ionicons name={customersOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
        </View>
      </Pressable>
      {customersOpen ? (
        customers.length === 0 ? (
          <EmptyState icon="people-outline" message="ยังไม่มีลูกค้า" />
        ) : (
          <View style={styles.accBody}>
            {customers.map((item) => (
              <View key={item.id} style={styles.accRowStatic}>
                <Avatar name={item.name} color={color} size={36} />
                <View style={styles.accTextBox}>
                  <Text style={styles.accRowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.phone ? (
                    <Text style={styles.accMetaText} numberOfLines={1}>
                      {item.phone}
                    </Text>
                  ) : null}
                  {item.note ? (
                    <Text style={styles.customerNote} numberOfLines={1}>
                      {item.note}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}

      {me?.role !== "MEMBER" ? (
        <Pressable accessibilityRole="button" onPress={async () => {
          try { const overview = await api<any>("/studypath/portal/overview"); Alert.alert("StudyPath Portal", `ผู้ใช้ ${overview.users} · วิชา ${overview.subjects} · เอกสาร ${overview.materials} · Quiz ${overview.quizzes}`); }
          catch (cause) { Alert.alert("Portal", cause instanceof Error ? cause.message : "ไม่มีสิทธิ์"); }
        }} style={styles.accHeader}>
          <View style={styles.accLeft}><View style={[styles.accIcon,{backgroundColor:color+"1a"}]}><Ionicons name="school-outline" size={18} color={color}/></View><View style={styles.accTextBox}><Text style={styles.accTitle}>University / Lecturer Portal</Text><Text style={styles.accSub}>ภาพรวมการใช้งาน StudyPath</Text></View></View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted}/>
        </Pressable>
      ) : null}

      {/* ออกจากระบบ */}
      <Pressable accessibilityRole="button" onPress={logout} style={styles.logoutBtn}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>ออกจากระบบ</Text>
      </Pressable>

      <Text style={styles.footer}>StudyPath · Personal Learning OS</Text>

      {/* สร้างการนัดประชุม */}
      <Modal visible={meetingOpen} transparent animationType="fade" onRequestClose={() => setMeetingOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>สร้างการนัดประชุม</Text>
            <TextInput
              placeholder="หัวข้อประชุม"
              value={meetingTitle}
              onChangeText={setMeetingTitle}
              style={styles.input}
            />
            <TextInput
              placeholder="วันและเวลา เช่น 2026-10-10 14:00"
              value={meetingDate}
              onChangeText={setMeetingDate}
              style={styles.input}
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setMeetingOpen(false)} style={styles.ghostBtn}>
                <Text style={styles.ghostText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving || !meetingTitle.trim() || !meetingDate.trim()}
                onPress={() => void createMeeting()}
                style={[styles.primaryBtn, { backgroundColor: color }]}
              >
                <Text style={styles.primaryText}>{saving ? "กำลังสร้าง..." : "สร้าง"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* เพิ่มลูกค้า */}
      <Modal visible={customerOpen} transparent animationType="fade" onRequestClose={() => setCustomerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>เพิ่มลูกค้า</Text>
            <TextInput
              placeholder="ชื่อลูกค้า"
              value={customerName}
              onChangeText={setCustomerName}
              style={styles.input}
            />
            <TextInput
              placeholder="เบอร์โทร (ไม่บังคับ)"
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
              style={styles.input}
            />
            <TextInput
              placeholder="หมายเหตุ (ไม่บังคับ)"
              value={customerNote}
              onChangeText={setCustomerNote}
              style={styles.input}
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setCustomerOpen(false)} style={styles.ghostBtn}>
                <Text style={styles.ghostText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving || !customerName.trim()}
                onPress={() => void createCustomer()}
                style={[styles.primaryBtn, { backgroundColor: color }]}
              >
                <Text style={styles.primaryText}>{saving ? "กำลังเพิ่ม..." : "เพิ่มลูกค้า"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Accordion (เมนูย่อ/ขยาย)
  accHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    ...shadow.card,
  },
  accLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: spacing.md },
  accRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  accIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  accTextBox: { flex: 1 },
  accTitle: { ...font.title, fontSize: 15 },
  accSub: { ...font.caption, marginTop: 1 },
  accAddBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  accBody: { marginBottom: spacing.lg, gap: spacing.sm },
  accRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  accRowStatic: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  accRowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  accDot: { width: 8, height: 8, borderRadius: 4 },
  accRowTitle: { ...font.label, fontWeight: "600", color: colors.text, flex: 1 },
  accRowBody: { ...font.body, color: colors.textSecondary, marginTop: spacing.sm },
  accMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs },
  accMetaText: { ...font.caption },

  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, marginBottom: spacing.sm },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.lg,
    marginBottom: spacing.xl,
    ...shadow.raised,
  },
  profileInfo: { flex: 1 },
  profileName: { color: "#fff", fontSize: 20, fontWeight: "700" },
  profileEmail: { color: "#ffffffd9", fontSize: 13, marginTop: 2 },
  section: { ...font.h3, marginBottom: spacing.md },
  incomeCard: { marginBottom: spacing.lg },
  incomeRow: { flexDirection: "row", alignItems: "center" },
  incomeItem: { flex: 1, alignItems: "center" },
  incomeDivider: { width: 1, height: 40, backgroundColor: colors.border },
  incomeLabel: { ...font.caption },
  incomeValue: { fontSize: 20, fontWeight: "700", marginTop: 2 },
  incomeSub: { ...font.caption, marginTop: 2 },
  settingLabel: { ...font.label, marginBottom: spacing.md },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.xl,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#f0c9c6",
    backgroundColor: "#fdf3f2",
  },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  footer: { ...font.caption, textAlign: "center", marginTop: spacing.xxl },
  list: { gap: spacing.md, marginBottom: spacing.xl },
  newsCard: { padding: spacing.lg, marginBottom: 0 },
  newsHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.xs },
  newsTitle: { ...font.title, flex: 1 },
  newsBody: { ...font.label },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  eventMetaText: { ...font.caption },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  sectionActionText: { fontSize: 13, fontWeight: "600", color: colors.accent },
  backdrop: { flex: 1, backgroundColor: "#0009", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  dialog: { width: "100%", maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, ...shadow.raised },
  dialogTitle: { ...font.h3 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  ghostBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  ghostText: { color: colors.textSecondary, fontWeight: "600" },
  primaryBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  productInfo: { flex: 1 },
  productName: { ...font.title },
  productMeta: { ...font.label, marginTop: 2 },
  customerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, marginBottom: 0 },
  customerNote: { ...font.caption, marginTop: 2 },
  dialogMeta: { ...font.label },
});
