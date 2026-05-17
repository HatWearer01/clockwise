import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { useSettingsStore } from "../../src/store/settings";
import { useTimerStore } from "../../src/store/timer";
import { useScheduleStore } from "../../src/store/schedule";
import { getColors } from "../../src/lib/theme";
import { formatMinuteAsTime } from "../../src/lib/time";
import { exportDatabase, importDatabase } from "../../src/services/backup";

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseHmToMinutes(raw: string): number | null {
  const s = raw.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHmInput(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type SegmentedOption<T extends string> = { key: T; label: string };

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  colors,
  borderColor,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  colors: ReturnType<typeof getColors>;
  borderColor: string;
}) {
  return (
    <View style={[segStyles.track, { borderColor, backgroundColor: colors.surfaceAlt }]}>
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={({ pressed }) => [
              segStyles.segment,
              selected && { backgroundColor: colors.primary + "30" },
              pressed && !selected && { opacity: 0.85 },
            ]}
          >
            <Text
              style={[
                segStyles.segmentText,
                { color: selected ? colors.primary : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const segStyles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: { fontSize: 13, fontWeight: "800" },
});

function SectionCard({
  title,
  children,
  colors,
  cardBorder,
}: {
  title: string;
  children: ReactNode;
  colors: ReturnType<typeof getColors>;
  cardBorder: string;
}) {
  return (
    <View
      style={[
        sectionStyles.card,
        {
          backgroundColor: colors.surface,
          borderColor: cardBorder,
          ...Platform.select({
            android: { elevation: 3 },
            default: {
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
            },
          }),
        },
      ]}
    >
      <Text style={[sectionStyles.sectionHeader, { color: colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 14,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 14,
  },
});

export default function SettingsScreen() {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const theme = useSettingsStore((s) => s.theme);
  const appSettings = useSettingsStore((s) => s.appSettings);
  const settingsSaving = useSettingsStore((s) => s.settingsSaving);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setAppSettings = useSettingsStore((s) => s.setAppSettings);

  const c = getColors(resolvedTheme);
  const cardBorder = resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : c.border;
  const dividerColor = resolvedTheme === "dark" ? "rgba(255,255,255,0.08)" : c.border;

  const tf = appSettings.time_format;
  const [reminderDraft, setReminderDraft] = useState(String(appSettings.reminder_interval_min));
  const [quietStartEdit, setQuietStartEdit] = useState(() => minutesToHmInput(appSettings.quiet_hours_start_min));
  const [quietEndEdit, setQuietEndEdit] = useState(() => minutesToHmInput(appSettings.quiet_hours_end_min));

  useEffect(() => {
    setReminderDraft(String(appSettings.reminder_interval_min));
  }, [appSettings.reminder_interval_min]);

  useEffect(() => {
    setQuietStartEdit(minutesToHmInput(appSettings.quiet_hours_start_min));
    setQuietEndEdit(minutesToHmInput(appSettings.quiet_hours_end_min));
  }, [appSettings.quiet_hours_start_min, appSettings.quiet_hours_end_min]);

  const reminderParsed = useMemo(() => {
    const n = parseInt(reminderDraft, 10);
    return Number.isNaN(n) ? appSettings.reminder_interval_min : clampInt(n, 1, 120);
  }, [reminderDraft, appSettings.reminder_interval_min]);

  function bumpReminder(delta: number) {
    const next = clampInt(reminderParsed + delta, 1, 120);
    setReminderDraft(String(next));
    void setAppSettings({ reminder_interval_min: next });
  }

  const switchTrackOff = resolvedTheme === "dark" ? "#334155" : c.surfaceAlt;
  const switchTrackOn = c.primary + "99";

  const rowStyles = useMemo(() => makeRowStyles(c, dividerColor), [c, dividerColor]);

  return (
    <SafeAreaView style={[rowStyles.container, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={rowStyles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[rowStyles.title, { color: c.text }]}>Settings</Text>
        <Text style={[rowStyles.lead, { color: c.textMuted }]}>
          Customize how Clockwise works on this device.
        </Text>

        <SectionCard title="Theme" colors={c} cardBorder={cardBorder}>
          <Text style={[rowStyles.fieldHelp, { color: c.textMuted }]}>Appearance for this app.</Text>
          <SegmentedControl
            options={[
              { key: "dark" as const, label: "Dark" },
              { key: "light" as const, label: "Light" },
              { key: "system" as const, label: "System" },
            ]}
            value={theme}
            onChange={(v) => setTheme(v)}
            colors={c}
            borderColor={cardBorder}
          />
        </SectionCard>

        <SectionCard title="Notifications" colors={c} cardBorder={cardBorder}>
          <View style={rowStyles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[rowStyles.rowTitle, { color: c.text }]}>Shift reminders</Text>
              <Text style={[rowStyles.rowDesc, { color: c.textMuted }]}>
                Nudges around clock in/out at shift boundaries.
              </Text>
            </View>
            <Switch
              value={appSettings.notifications_enabled}
              onValueChange={(v) => void setAppSettings({ notifications_enabled: v })}
              trackColor={{ false: switchTrackOff, true: switchTrackOn }}
              thumbColor={appSettings.notifications_enabled ? c.primary : c.textMuted}
            />
          </View>

          <View style={[rowStyles.divider, { backgroundColor: dividerColor }]} />

          <View style={rowStyles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[rowStyles.rowTitle, { color: c.text }]}>Quiet hours</Text>
              <Text style={[rowStyles.rowDesc, { color: c.textMuted }]}>
                {appSettings.quiet_hours_enabled
                  ? `Silenced ${formatMinuteAsTime(appSettings.quiet_hours_start_min, tf)} – ${formatMinuteAsTime(
                      appSettings.quiet_hours_end_min,
                      tf,
                    )}.`
                  : "Suppress reminders during set hours."}
              </Text>
            </View>
            <Switch
              value={appSettings.quiet_hours_enabled}
              onValueChange={(v) => void setAppSettings({ quiet_hours_enabled: v })}
              trackColor={{ false: switchTrackOff, true: switchTrackOn }}
              thumbColor={appSettings.quiet_hours_enabled ? c.primary : c.textMuted}
            />
          </View>

          {appSettings.quiet_hours_enabled ? (
            <View style={rowStyles.quietTimeCard}>
              <View style={[rowStyles.quietTimeInner, { backgroundColor: c.bg, borderColor: cardBorder }]}>
                <View style={rowStyles.quietField}>
                  <View style={rowStyles.quietLabelRow}>
                    <Ionicons name="moon-outline" size={14} color={c.textMuted} />
                    <Text style={[rowStyles.quietLabel, { color: c.textMuted }]}>From</Text>
                  </View>
                  <TextInput
                    style={[rowStyles.timeInput, { color: c.text, borderColor: cardBorder, backgroundColor: c.surface }]}
                    value={quietStartEdit}
                    placeholder="22:00"
                    placeholderTextColor={c.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setQuietStartEdit}
                    onBlur={() => {
                      const parsed = parseHmToMinutes(quietStartEdit);
                      if (parsed != null) void setAppSettings({ quiet_hours_start_min: parsed });
                      else setQuietStartEdit(minutesToHmInput(appSettings.quiet_hours_start_min));
                    }}
                  />
                </View>
                <View style={[rowStyles.quietArrow, { backgroundColor: dividerColor }]} />
                <View style={rowStyles.quietField}>
                  <View style={rowStyles.quietLabelRow}>
                    <Ionicons name="sunny-outline" size={14} color={c.textMuted} />
                    <Text style={[rowStyles.quietLabel, { color: c.textMuted }]}>To</Text>
                  </View>
                  <TextInput
                    style={[rowStyles.timeInput, { color: c.text, borderColor: cardBorder, backgroundColor: c.surface }]}
                    value={quietEndEdit}
                    placeholder="08:00"
                    placeholderTextColor={c.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setQuietEndEdit}
                    onBlur={() => {
                      const parsed = parseHmToMinutes(quietEndEdit);
                      if (parsed != null) void setAppSettings({ quiet_hours_end_min: parsed });
                      else setQuietEndEdit(minutesToHmInput(appSettings.quiet_hours_end_min));
                    }}
                  />
                </View>
              </View>
              <Text style={[rowStyles.quietHint, { color: c.textMuted }]}>24-hour HH:MM · local time</Text>
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Schedule" colors={c} cardBorder={cardBorder}>
          <Text style={[rowStyles.inlineLabel, { color: c.text }]}>Week starts on</Text>
          <Text style={[rowStyles.fieldHelp, { color: c.textMuted, marginBottom: 10 }]}>
            Used for summaries and the week chart.
          </Text>
          <SegmentedControl
            options={[
              { key: "1" as const, label: "Monday" },
              { key: "0" as const, label: "Sunday" },
            ]}
            value={String(appSettings.week_start_day) as "0" | "1"}
            onChange={(v) => void setAppSettings({ week_start_day: v === "0" ? 0 : 1 })}
            colors={c}
            borderColor={cardBorder}
          />

          <View style={[rowStyles.divider, { backgroundColor: dividerColor, marginVertical: 18 }]} />

          <Text style={[rowStyles.inlineLabel, { color: c.text }]}>Time format</Text>
          <Text style={[rowStyles.fieldHelp, { color: c.textMuted, marginBottom: 10 }]}>
            How times appear across the app.
          </Text>
          <SegmentedControl
            options={[
              { key: "12h" as const, label: "12-hour" },
              { key: "24h" as const, label: "24-hour" },
            ]}
            value={appSettings.time_format}
            onChange={(v) => void setAppSettings({ time_format: v })}
            colors={c}
            borderColor={cardBorder}
          />

          <View style={[rowStyles.divider, { backgroundColor: dividerColor, marginVertical: 18 }]} />

          <Text style={[rowStyles.inlineLabel, { color: c.text }]}>Accountability mode</Text>
          <Text style={[rowStyles.fieldHelp, { color: c.textMuted, marginBottom: 10 }]}>
            {appSettings.accountability_mode === "target"
              ? "Tracks daily targets and nudges if you fall behind."
              : "Focus on clock in/out around scheduled shifts."}
          </Text>
          <SegmentedControl
            options={[
              { key: "shift" as const, label: "Shift" },
              { key: "target" as const, label: "Target" },
            ]}
            value={appSettings.accountability_mode}
            onChange={(v) => void setAppSettings({ accountability_mode: v })}
            colors={c}
            borderColor={cardBorder}
          />
        </SectionCard>

        <SectionCard title="Reminders" colors={c} cardBorder={cardBorder}>
          <Text style={[rowStyles.rowDesc, { color: c.textMuted }]}>
            Minutes between repeated clock-in/out reminders (1–120).
          </Text>

          <View style={[rowStyles.stepperCard, { borderColor: cardBorder, backgroundColor: c.bg }]}>
            <Pressable
              style={({ pressed }) => [
                rowStyles.stepperBtn,
                { borderColor: cardBorder, backgroundColor: c.surface },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => bumpReminder(-1)}
              accessibilityLabel="Decrease reminder interval"
            >
              <Ionicons name="remove" size={22} color={c.primary} />
            </Pressable>
            <TextInput
              style={[rowStyles.stepperInput, { color: c.text }]}
              value={reminderDraft}
              placeholder="5"
              placeholderTextColor={c.textMuted}
              keyboardType="number-pad"
              textAlign="center"
              selectTextOnFocus
              onChangeText={(t) => {
                setReminderDraft(t);
                const n = parseInt(t, 10);
                if (t === "" || Number.isNaN(n)) return;
                void setAppSettings({ reminder_interval_min: clampInt(n, 1, 120) });
              }}
              onBlur={() => {
                const n = parseInt(reminderDraft, 10);
                const safe = Number.isNaN(n) ? appSettings.reminder_interval_min : clampInt(n, 1, 120);
                setReminderDraft(String(safe));
                void setAppSettings({ reminder_interval_min: safe });
              }}
            />
            <Text style={[rowStyles.stepperUnit, { color: c.textMuted }]}>min</Text>
            <Pressable
              style={({ pressed }) => [
                rowStyles.stepperBtn,
                { borderColor: cardBorder, backgroundColor: c.surface },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => bumpReminder(1)}
              accessibilityLabel="Increase reminder interval"
            >
              <Ionicons name="add" size={22} color={c.primary} />
            </Pressable>
          </View>

          <Text style={[rowStyles.presetLabel, { color: c.textMuted }]}>Quick picks</Text>
          <View style={rowStyles.presetRow}>
            {[1, 2, 5, 10, 15, 30].map((m) => {
              const selected = appSettings.reminder_interval_min === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    setReminderDraft(String(m));
                    void setAppSettings({ reminder_interval_min: m });
                  }}
                  style={[
                    rowStyles.presetChip,
                    {
                      borderColor: selected ? c.primary : cardBorder,
                      backgroundColor: selected ? c.primary + "28" : c.surfaceAlt,
                    },
                  ]}
                >
                  <Text style={[rowStyles.presetChipText, { color: selected ? c.primary : c.text }]}>{m}m</Text>
                </Pressable>
              );
            })}
          </View>
        </SectionCard>

        <SectionCard title="Data" colors={c} cardBorder={cardBorder}>
          <Text style={[rowStyles.rowDesc, { color: c.textMuted, marginBottom: 14 }]}>
            Import your desktop database or export the mobile database to transfer between devices.
          </Text>

          <Pressable
            style={({ pressed }) => [
              rowStyles.dataBtn,
              { borderColor: cardBorder, backgroundColor: c.bg, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={async () => {
              try {
                await exportDatabase();
              } catch (e) {
                Alert.alert("Export Failed", e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <Ionicons name="share-outline" size={20} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[rowStyles.dataBtnTitle, { color: c.text }]}>Export Database</Text>
              <Text style={[rowStyles.dataBtnDesc, { color: c.textMuted }]}>Share your mobile data as a .db file</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              rowStyles.dataBtn,
              { borderColor: cardBorder, backgroundColor: c.bg, opacity: pressed ? 0.8 : 1, marginTop: 10 },
            ]}
            onPress={async () => {
              const result = await importDatabase();
              if (result.success) {
                await useSettingsStore.getState().init();
                await useTimerStore.getState().load();
                await useScheduleStore.getState().load();
                Alert.alert("Import Successful", "Database replaced. All data has been loaded from the imported file.");
              } else if (result.error && result.error !== "No file selected.") {
                Alert.alert("Import Failed", result.error);
              }
            }}
          >
            <Ionicons name="download-outline" size={20} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[rowStyles.dataBtnTitle, { color: c.text }]}>Import Database</Text>
              <Text style={[rowStyles.dataBtnDesc, { color: c.textMuted }]}>Replace mobile data with a .db file from your PC</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </Pressable>

          <Text style={[rowStyles.quietHint, { color: c.textMuted, marginTop: 12 }]}>
            Desktop DB location: Documents/Clockwise/clockwise.db
          </Text>
        </SectionCard>

        {settingsSaving ? (
          <Text style={[rowStyles.saving, { color: c.textMuted }]}>Saving…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeRowStyles(_c: ReturnType<typeof getColors>, _dividerColor: string) {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 28, fontWeight: "800" },
    lead: { fontSize: 14, marginTop: 8, marginBottom: 6, lineHeight: 20 },
    fieldHelp: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
    inlineLabel: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
    rowTitle: { fontSize: 16, fontWeight: "800" },
    rowDesc: { fontSize: 13, marginTop: 4, lineHeight: 19 },
    switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    divider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
    quietTimeCard: { marginTop: 4 },
    quietTimeInner: {
      flexDirection: "row",
      alignItems: "stretch",
      borderRadius: 14,
      borderWidth: 1,
      padding: 12,
      gap: 10,
    },
    quietField: { flex: 1 },
    quietLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
    quietLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
    quietArrow: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", marginHorizontal: 4 },
    timeInput: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      fontSize: 17,
      fontVariant: ["tabular-nums"],
    },
    quietHint: { fontSize: 11, marginTop: 10, marginLeft: 2 },
    stepperCard: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginTop: 14,
      gap: 8,
    },
    stepperBtn: {
      width: 48,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    stepperInput: {
      flex: 1,
      fontSize: 22,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
      paddingVertical: 4,
    },
    stepperUnit: { fontSize: 14, fontWeight: "700", marginRight: 4 },
    presetLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 18 },
    presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    presetChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
    },
    presetChipText: { fontSize: 13, fontWeight: "800" },
    saving: { textAlign: "center", marginTop: 8, fontSize: 13 },
    dataBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    dataBtnTitle: { fontSize: 15, fontWeight: "700" },
    dataBtnDesc: { fontSize: 12, marginTop: 2 },
  });
}
