import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  registerGlobals,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { useLocalSearchParams } from "expo-router";
import { api } from "../../lib/api";

export default function Call() {
  const { room } = useLocalSearchParams<{ room: string }>();
  const [credentials, setCredentials] = useState<{ token: string; url: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function connect() {
      try {
        registerGlobals();
        const result = await api(`/call/token?room=${encodeURIComponent(room)}`);
        if (!active) return;
        await AudioSession.startAudioSession();
        setCredentials(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "เข้าร่วมห้องไม่สำเร็จ");
      }
    }

    void connect();
    return () => {
      active = false;
      void AudioSession.stopAudioSession();
    };
  }, [room]);

  if (error) return <View style={styles.center}><Text>{error}</Text></View>;
  if (!credentials) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <LiveKitRoom serverUrl={credentials.url} token={credentials.token} connect audio video>
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