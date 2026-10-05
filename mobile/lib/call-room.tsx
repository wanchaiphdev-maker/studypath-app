import { FlatList, StyleSheet, View } from "react-native";
import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  registerGlobals,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import { Track } from "livekit-client";

/**
 * โมดูลที่ต้องใช้ WebRTC (มีเฉพาะใน APK / dev client — Expo Go ไม่มี)
 * ถูกโหลดด้วย `import()` ตอนเปิดหน้าเท่านั้น เพื่อให้แอปเปิดได้แม้ไม่มี WebRTC
 */

export function prepareCall(): Promise<void> {
  registerGlobals();
  return AudioSession.startAudioSession();
}

export function endCall(): void {
  void AudioSession.stopAudioSession();
}

export function CallRoom({ serverUrl, token }: { serverUrl: string; token: string }) {
  return (
    <LiveKitRoom serverUrl={serverUrl} token={token} connect audio video>
      <CallTracks />
    </LiveKitRoom>
  );
}

function CallTracks() {
  const tracks = useTracks([Track.Source.Camera]);

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={tracks}
      keyExtractor={(track, trackIndex) => `${trackIndex}`}
      renderItem={({ item }) => isTrackReference(item)
        ? <VideoTrack trackRef={item} style={styles.video} />
        : <View style={styles.video} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  list: { flexGrow: 1, justifyContent: "center", gap: 8, padding: 8 },
  video: { width: "100%", height: 280, backgroundColor: "#17231f", borderRadius: 8 },
});
