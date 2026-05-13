import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from "react-native";
import * as NavigationBar from "expo-navigation-bar";
import { useSettingsStore } from "../src/store/settings";
import { useTimerStore } from "../src/store/timer";
import { getDb } from "../src/db/connection";
import { initLifecycle, reconcileStaleSession } from "../src/services/lifecycle";
import { getColors } from "../src/lib/theme";
import { formatShortTime } from "../src/lib/time";
import type { PendingRecovery } from "../src/types";

export default function RootLayout() {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const init = useSettingsStore((s) => s.init);
  const applyPendingRecovery = useTimerStore((s) => s.applyPendingRecovery);
  const [recovery, setRecovery] = useState<PendingRecovery | null>(null);
  const [ready, setReady] = useState(false);
  const initDone = useRef(false);
  const c = getColors(resolvedTheme);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    (async () => {
      await getDb();
      await init();
      await initLifecycle();
      setReady(true);
      const stale = await reconcileStaleSession();
      if (stale) setRecovery(stale);
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS === "android") {
      try {
        NavigationBar.setBackgroundColorAsync(c.surface);
        NavigationBar.setButtonStyleAsync(resolvedTheme === "dark" ? "light" : "dark");
      } catch {
        // edge-to-edge or Expo Go may not support this
      }
    }
  }, [resolvedTheme, c.surface]);

  if (!ready) {
    return (
      <View style={[styles.splash, { backgroundColor: c.bg }]}>
        <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      {recovery && (
        <View style={[styles.recoveryBanner, { backgroundColor: c.warning }]}>
          <Text style={styles.recoveryText}>
            Stale session detected (started {formatShortTime(recovery.started_at)}).
          </Text>
          <View style={styles.recoveryActions}>
            <TouchableOpacity
              style={[styles.recoveryBtn, { backgroundColor: "#fff3" }]}
              onPress={async () => {
                await applyPendingRecovery(recovery.suggested_end_at);
                setRecovery(null);
              }}
            >
              <Text style={styles.recoveryBtnText}>End at last heartbeat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.recoveryBtn, { backgroundColor: "#fff3" }]}
              onPress={() => setRecovery(null)}
            >
              <Text style={styles.recoveryBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  recoveryBanner: {
    padding: 16,
    paddingTop: 48,
  },
  recoveryText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  recoveryActions: {
    flexDirection: "row",
    gap: 8,
  },
  recoveryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  recoveryBtnText: {
    color: "#000",
    fontSize: 13,
    fontWeight: "600",
  },
});
