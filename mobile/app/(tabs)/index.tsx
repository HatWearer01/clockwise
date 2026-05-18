import { useEffect, useRef, useCallback, useState, type ReactNode } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  AppState as RNAppState,
  TextInput,
  Pressable,
  Platform,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, G } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useTimerStore } from "../../src/store/timer";
import { useScheduleStore } from "../../src/store/schedule";
import { useSettingsStore } from "../../src/store/settings";
import { getColors, type ColorScheme } from "../../src/lib/theme";
import {
  formatDuration,
  formatHoursMinutes,
  stateMessage,
  isCurrentlyInSchedule,
  pct,
  shiftProgressFraction,
  todayDateString,
  todayISODate,
  blockDurationMs,
  formatMinuteAsTime,
  formatShortTime,
} from "../../src/lib/time";
import * as TaskService from "../../src/services/task";
import * as InsightService from "../../src/services/insight";
import { markDayDone } from "../../src/services/session";
import { isDndActive } from "../../src/services/notification";
import type { DailyTask, Insight, StatusState } from "../../src/types";

const CHIP_LABELS: Record<StatusState, string> = {
  on_clock: "On the clock",
  on_break: "On break",
  off_day: "Off day",
  before_shift: "Starts later",
  in_shift: "In shift",
  after_shift: "After shift",
  week_done: "Week done",
  day_done: "Done for today",
  behind_target: "Behind target",
};

function chipTheme(state: StatusState, c: ColorScheme) {
  switch (state) {
    case "on_clock":
      return { dot: c.onClock, fg: c.onClock, bg: c.onClock + "28" };
    case "on_break":
      return { dot: c.onBreak, fg: c.onBreak, bg: c.onBreak + "28" };
    case "off_day":
      return { dot: c.offDay, fg: c.offDay, bg: c.offDay + "28" };
    case "before_shift":
      return { dot: c.accent, fg: c.accent, bg: c.accent + "28" };
    case "in_shift":
      return { dot: c.primary, fg: c.primary, bg: c.primary + "28" };
    case "after_shift":
      return { dot: c.textMuted, fg: c.textSecondary, bg: c.surfaceAlt };
    case "week_done":
      return { dot: c.accent, fg: c.accent, bg: c.accent + "28" };
    case "day_done":
      return { dot: c.positive, fg: c.positive, bg: c.positive + "28" };
    case "behind_target":
      return { dot: c.warning, fg: c.warning, bg: c.warning + "28" };
    default:
      return { dot: c.textMuted, fg: c.textSecondary, bg: c.surfaceAlt };
  }
}

function Ring(props: { fraction: number; size: number; stroke: number; trackColor: string; progressColor: string; children: ReactNode }) {
  const { fraction, size, stroke, trackColor, progressColor, children } = props;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = circumference * (1 - clamped);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <G transform={`rotate(-90 ${cx} ${cy})`}>
          <Circle cx={cx} cy={cy} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
          <Circle cx={cx} cy={cy} r={radius} stroke={progressColor} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${circumference}, ${circumference}`} strokeDashoffset={offset} />
        </G>
      </Svg>
      <View style={{ alignItems: "center", justifyContent: "center" }}>{children}</View>
    </View>
  );
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const RING_SIZE = Math.min(SCREEN_WIDTH * 0.55, 260);

export default function TodayScreen() {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const c = getColors(resolvedTheme);
  const accountabilityMode = useSettingsStore((s) => s.appSettings.accountability_mode);
  const timeFormat = useSettingsStore((s) => s.appSettings.time_format);

  const status = useTimerStore((s) => s.status);
  const error = useTimerStore((s) => s.error);
  const load = useTimerStore((s) => s.load);
  const refreshStatus = useTimerStore((s) => s.refreshStatus);
  const clockIn = useTimerStore((s) => s.clockIn);
  const clockOut = useTimerStore((s) => s.clockOut);
  const startBreak = useTimerStore((s) => s.startBreak);
  const resumeBreak = useTimerStore((s) => s.resumeBreak);
  const tick = useTimerStore((s) => s.tick);
  const clearError = useTimerStore((s) => s.clearError);
  const liveWorkedMs = useTimerStore((s) => s.liveWorkedMs);
  const liveShiftCoverageMs = useTimerStore((s) => s.liveShiftCoverageMs);
  const nowMs = useTimerStore((s) => s.nowMs);

  const blocks = useScheduleStore((s) => s.blocks);
  const loadSchedule = useScheduleStore((s) => s.load);

  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [dndActive, setDndActive] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);

  const isoToday = todayISODate();
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { load(); loadSchedule(); }, []);
  useEffect(() => {
    tickInterval.current = setInterval(() => tick(), 1000);
    return () => { if (tickInterval.current) clearInterval(tickInterval.current); };
  }, []);
  useEffect(() => {
    const id = setInterval(() => refreshStatus(), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (s) => { if (s === "active") refreshStatus(); });
    return () => sub.remove();
  }, []);

  const loadTasks = useCallback(async () => {
    try { setTasks(await TaskService.getDailyTasks(isoToday)); } catch { /* */ }
  }, [isoToday]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => { isDndActive().then(setDndActive).catch(() => {}); }, []);
  useEffect(() => { InsightService.getInsights().then(setInsights).catch(() => {}); }, []);

  if (!status) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: c.bg }]}>
        <View style={s.loadingWrap}><Text style={{ color: c.textSecondary, fontSize: 16 }}>Loading...</Text></View>
      </SafeAreaView>
    );
  }

  const todayDow = new Date().getDay();
  const todayBlocks = blocks.filter((b) => b.day_of_week === todayDow).sort((a, b) => a.start_min - b.start_min);
  const plannedMs = todayBlocks.reduce((sum, b) => sum + blockDurationMs(b.start_min, b.end_min), 0);
  const targetMs = status.target_today_ms > 0 ? status.target_today_ms : plannedMs;
  const isShiftMode = accountabilityMode === "shift";
  const tasksDone = tasks.filter((t) => t.done).length;

  const activeElapsed = status.active_session ? nowMs - status.active_session.started_at : 0;
  const worked = liveWorkedMs();
  const remainingMs = Math.max(0, targetMs - worked);
  const progressFrac = targetMs > 0 ? Math.min(1, worked / targetMs) : 0;
  const isOvertime = worked > targetMs && targetMs > 0;

  const inScheduleNow = isCurrentlyInSchedule(blocks);
  const liveCoverage = liveShiftCoverageMs(inScheduleNow);
  const shiftRingFrac = isShiftMode && plannedMs > 0 ? shiftProgressFraction(worked, liveCoverage, plannedMs) : progressFrac;
  const ringFraction = isShiftMode && plannedMs > 0 ? shiftRingFrac : progressFrac;
  const ringPct = Math.round(ringFraction * 100);

  const isWeekDone = status.state === "week_done" || status.week_done;
  const isDayDone = status.state === "day_done" || status.day_done;
  const isActive = Boolean(status.active_session);

  const headline = isWeekDone && !isActive
    ? "Week complete"
    : isDayDone && !isActive
      ? "Done for today"
      : isActive
        ? formatDuration(activeElapsed)
        : "Ready when you are";

  const statusMsg = status.overnight_session && status.active_session
    ? "Continuing overnight shift"
    : stateMessage(status.state, status.next_boundary_ms);

  const chip = chipTheme(status.state, c);
  const ringColor = status.state === "on_clock" ? c.onClock : status.state === "on_break" ? c.onBreak : c.primary;

  const scheduleStart = todayBlocks.length > 0 ? todayBlocks[0].start_min : null;
  const scheduleEnd = todayBlocks.length > 0 ? todayBlocks[todayBlocks.length - 1].end_min : null;
  let scheduleStatText: string;
  if (scheduleStart !== null && scheduleEnd !== null) {
    scheduleStatText = `${formatMinuteAsTime(scheduleStart, timeFormat)} – ${formatMinuteAsTime(scheduleEnd, timeFormat)} (${formatHoursMinutes(plannedMs)})`;
  } else if (plannedMs === 0 && status.target_today_ms > 0) {
    scheduleStatText = `Flex day · Target: ${formatHoursMinutes(status.target_today_ms)}`;
  } else {
    scheduleStatText = "No shift today";
  }

  async function handleToggleTask(id: number, done: boolean) {
    try {
      await TaskService.toggleDailyTask(id, done);
      const updated = await TaskService.getDailyTasks(isoToday);
      setTasks(updated);
      if (updated.length > 0 && updated.every((t) => t.done)) { await markDayDone(true); void refreshStatus(); }
      else if (!done && isDayDone) { await markDayDone(false); void refreshStatus(); }
      Haptics.selectionAsync();
    } catch { /* */ }
  }

  async function handleAddTask() {
    const text = newTaskText.trim();
    if (!text) return;
    try { await TaskService.addDailyTask(isoToday, text); setNewTaskText(""); await loadTasks(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* */ }
  }

  async function toggleDayDone() {
    const next = !isDayDone;
    try { await markDayDone(next); void refreshStatus(); Haptics.notificationAsync(next ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning); } catch { /* */ }
  }

  // ──────────── COMPACT VIEW (full screen, no card) ────────────
  if (!expanded) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
        {error ? (
          <TouchableOpacity onPress={clearError} style={[s.errorBanner, { backgroundColor: c.error + "18", borderColor: c.error + "44" }]}>
            <Text style={{ color: c.error, fontSize: 13 }}>{error}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Top bar */}
        <View style={s.topBar}>
          <View style={[s.brand, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
            <Ionicons name="time" size={14} color={c.primary} />
            <Text style={[s.brandText, { color: c.text }]}>Clockwise</Text>
          </View>
          <Text style={[s.datetime, { color: c.textSecondary }]}>{todayDateString()}</Text>
          <Pressable onPress={() => setExpanded(true)} style={[s.expandBtn, { borderColor: c.border }]}>
            <Ionicons name="expand-outline" size={16} color={c.textSecondary} />
          </Pressable>
        </View>

        {/* Giant ring + headline centered on screen */}
        <View style={s.heroArea}>
          <Ring fraction={ringFraction} size={RING_SIZE} stroke={14} trackColor={c.surfaceAlt} progressColor={ringColor}>
            <Text style={[s.heroPct, { color: c.text }]}>{ringPct}%</Text>
            <Text style={[s.heroWorked, { color: c.textMuted }]}>{formatHoursMinutes(worked)}</Text>
          </Ring>

          <Text style={[s.heroHeadline, { color: c.text }]}>{headline}</Text>
          <Text style={[s.heroSubtext, { color: c.textSecondary }]}>{statusMsg}</Text>

          <View style={s.statsRow}>
            {isShiftMode && plannedMs > 0 ? (
              <>
                <Text style={[s.statText, { color: c.textSecondary }]}>
                  Worked <Text style={{ fontWeight: "700", color: c.text }}>{formatHoursMinutes(worked)}/{formatHoursMinutes(plannedMs)}</Text>
                </Text>
                {tasks.length > 0 ? <Text style={[s.statDivider, { color: c.border }]}>|</Text> : null}
                {tasks.length > 0 ? <Text style={[s.statText, { color: c.textSecondary }]}>Tasks <Text style={{ fontWeight: "700", color: c.text }}>{tasksDone}/{tasks.length}</Text></Text> : null}
              </>
            ) : (
              <>
                <Text style={[s.statText, { color: c.textSecondary }]}>Worked <Text style={{ fontWeight: "700", color: c.text }}>{formatHoursMinutes(worked)}</Text></Text>
                {targetMs > 0 ? (
                  <>
                    <Text style={[s.statDivider, { color: c.border }]}>|</Text>
                    <Text style={[s.statText, { color: c.textSecondary }]}>
                      {isOvertime ? "Over " : "Left "}
                      <Text style={{ fontWeight: "700", color: isOvertime ? c.warning : c.text }}>
                        {isOvertime ? `+${formatHoursMinutes(worked - targetMs)}` : formatHoursMinutes(remainingMs)}
                      </Text>
                    </Text>
                  </>
                ) : null}
              </>
            )}
            {status.break_today_ms > 0 ? (
              <>
                <Text style={[s.statDivider, { color: c.border }]}>|</Text>
                <Text style={[s.statText, { color: c.textSecondary }]}>Break <Text style={{ fontWeight: "700", color: c.text }}>{formatHoursMinutes(status.break_today_ms)}</Text></Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Bottom: chip + buttons */}
        <View style={s.bottomBar}>
          <View style={s.chipRow}>
            <View style={[s.chip, { backgroundColor: chip.bg }]}>
              <View style={[s.chipDot, { backgroundColor: chip.dot }]} />
              <Text style={[s.chipLabel, { color: chip.fg }]}>{CHIP_LABELS[status.state]}</Text>
            </View>
            {status.off_schedule && isActive ? <View style={[s.offDot, { backgroundColor: c.warning }]} /> : null}
            {dndActive ? (
              <View style={[s.chip, { backgroundColor: c.surfaceAlt }]}>
                <Ionicons name="notifications-off-outline" size={11} color={c.textMuted} />
                <Text style={[s.chipLabel, { color: c.textMuted, marginLeft: 4 }]}>Paused</Text>
              </View>
            ) : null}
          </View>
          <View style={s.btnRow}>
            {isActive ? (
              <Pressable
                onPress={() => { status.paused ? (Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), void resumeBreak()) : (Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), void startBreak()); }}
                style={[s.pillBtn, { borderColor: c.border }]}
              >
                <Text style={[s.pillBtnText, { color: c.text }]}>{status.paused ? "Resume" : "Break"}</Text>
              </Pressable>
            ) : null}
            {!isActive ? (
              <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void clockIn(); }} style={[s.clockBtn, { backgroundColor: c.primary }]}>
                <Ionicons name="play" size={16} color="#0b1a13" />
                <Text style={[s.clockBtnText, { color: "#0b1a13" }]}>Clock in</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void clockOut(); }} style={[s.clockBtn, { backgroundColor: "#f4a63d" }]}>
                <Ionicons name="stop" size={16} color="#251704" />
                <Text style={[s.clockBtnText, { color: "#251704" }]}>Clock out</Text>
              </Pressable>
            )}
            {!isActive && (targetMs > 0 || isDayDone) ? (
              <Pressable onPress={() => void toggleDayDone()} style={[s.pillBtn, { borderColor: isDayDone ? c.primary : c.border, backgroundColor: isDayDone ? c.primary + "22" : "transparent" }]}>
                <Text style={[s.pillBtnText, { color: isDayDone ? c.primary : c.text }]}>{isDayDone ? "Day done ✓" : "Day done"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ──────────── EXPANDED VIEW (scrollable detail) ────────────
  return (
    <SafeAreaView style={[s.container, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={s.exScroll} keyboardShouldPersistTaps="handled">
        {error ? (
          <TouchableOpacity onPress={clearError} style={[s.errorBanner, { backgroundColor: c.error + "18", borderColor: c.error + "44" }]}>
            <Text style={{ color: c.error, fontSize: 13 }}>{error}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Collapse button */}
        <View style={s.topBar}>
          <View style={[s.brand, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
            <Ionicons name="time" size={14} color={c.primary} />
            <Text style={[s.brandText, { color: c.text }]}>Clockwise</Text>
          </View>
          <Text style={[s.datetime, { color: c.textSecondary }]}>{todayDateString()}</Text>
          <Pressable onPress={() => setExpanded(false)} style={[s.expandBtn, { borderColor: c.border }]}>
            <Ionicons name="contract-outline" size={16} color={c.textSecondary} />
          </Pressable>
        </View>

        {/* Summary card */}
        <View style={[s.exCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Ring fraction={ringFraction} size={80} stroke={8} trackColor={c.surfaceAlt} progressColor={ringColor}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>{ringPct}%</Text>
            </Ring>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: c.text, letterSpacing: -0.5 }}>{headline}</Text>
              <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }}>{statusMsg}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <View style={[s.chip, { backgroundColor: chip.bg }]}>
              <View style={[s.chipDot, { backgroundColor: chip.dot }]} />
              <Text style={[s.chipLabel, { color: chip.fg }]}>{CHIP_LABELS[status.state]}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {isActive ? (
                <Pressable
                  onPress={() => { status.paused ? void resumeBreak() : void startBreak(); }}
                  style={[s.pillBtn, { borderColor: c.border }]}
                >
                  <Text style={[s.pillBtnText, { color: c.text }]}>{status.paused ? "Resume" : "Break"}</Text>
                </Pressable>
              ) : null}
              {!isActive ? (
                <Pressable onPress={() => void clockIn()} style={[s.clockBtn, { backgroundColor: c.primary }]}>
                  <Ionicons name="play" size={14} color="#0b1a13" />
                  <Text style={[s.clockBtnText, { color: "#0b1a13" }]}>Clock in</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => void clockOut()} style={[s.clockBtn, { backgroundColor: "#f4a63d" }]}>
                  <Ionicons name="stop" size={14} color="#251704" />
                  <Text style={[s.clockBtnText, { color: "#251704" }]}>Clock out</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Progress bar */}
        {targetMs > 0 ? (
          <View style={[s.exCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={[s.progressTrack, { backgroundColor: c.surfaceAlt }]}>
              <View style={[s.progressFill, { width: `${Math.min(100, isShiftMode && plannedMs > 0 ? Math.round(shiftRingFrac * 100) : pct(worked, targetMs))}%`, backgroundColor: isOvertime ? c.warning : c.primary }]} />
            </View>
            <View style={s.progressRow}>
              <Text style={{ fontSize: 12, color: c.textMuted }}>{formatHoursMinutes(worked)} worked</Text>
              <Text style={{ fontSize: 12, color: c.textMuted }}>{formatHoursMinutes(targetMs)} {isShiftMode ? "shift" : "target"}</Text>
            </View>
          </View>
        ) : null}

        {/* Session & schedule */}
        <View style={[s.exCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          {status.active_session ? (
            <View style={[s.stat, { borderLeftColor: c.primary }]}>
              <Text style={[s.statLabel, { color: c.textMuted }]}>Current session{status.overnight_session ? " (yesterday)" : ""}</Text>
              <Text style={[s.statValue, { color: c.text }]}>{formatDuration(activeElapsed)}</Text>
              <Text style={{ fontSize: 12, color: c.textMuted }}>Started {formatShortTime(status.active_session.started_at, timeFormat)}</Text>
            </View>
          ) : null}
          <View style={[s.stat, { borderLeftColor: c.border }]}>
            <Text style={[s.statLabel, { color: c.textMuted }]}>Schedule</Text>
            <Text style={{ fontSize: 14, color: c.textSecondary }}>{scheduleStatText}</Text>
          </View>
        </View>

        {/* Tasks */}
        <View style={[s.exCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>Tasks</Text>
            <Text style={{ fontSize: 13, color: c.textMuted }}>{tasksDone}/{tasks.length}</Text>
          </View>
          <View style={[s.addRow, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}>
            <TextInput
              value={newTaskText}
              onChangeText={setNewTaskText}
              placeholder="Add a task..."
              placeholderTextColor={c.textMuted}
              onSubmitEditing={() => void handleAddTask()}
              returnKeyType="done"
              style={{ flex: 1, fontSize: 14, color: c.text, paddingVertical: 8 }}
            />
            <Pressable onPress={() => void handleAddTask()} disabled={!newTaskText.trim()} style={[s.addBtn, { backgroundColor: newTaskText.trim() ? c.primary : c.surfaceAlt }]}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: newTaskText.trim() ? "#0b1a13" : c.textMuted }}>Add</Text>
            </Pressable>
          </View>
          {tasks.map((task) => (
            <Pressable key={task.id} onPress={() => void handleToggleTask(task.id, !task.done)} style={s.taskRow}>
              <Ionicons name={task.done ? "checkbox" : "square-outline"} size={20} color={task.done ? c.primary : c.textMuted} />
              <Text style={{ flex: 1, fontSize: 14, color: task.done ? c.textMuted : c.text, textDecorationLine: task.done ? "line-through" : "none" }} numberOfLines={2}>
                {task.recurring_task_id != null ? "↻ " : ""}{task.text}
              </Text>
            </Pressable>
          ))}
          {tasks.length === 0 ? <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4 }}>No tasks yet.</Text> : null}
        </View>

        {/* Insights */}
        {insights.length > 0 ? (
          <View style={[s.exCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: c.text }}>Insights</Text>
            {insights.slice(0, 3).map((insight, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 }}>
                <Ionicons name="bulb-outline" size={16} color={c.accent} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: c.text }}>{insight.title}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{insight.body}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Day done */}
        {!isActive && (targetMs > 0 || isDayDone) ? (
          <Pressable onPress={() => void toggleDayDone()} style={[s.dayDoneBtn, { borderColor: isDayDone ? c.primary : c.border, backgroundColor: isDayDone ? c.primary + "22" : c.surface }]}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: isDayDone ? c.primary : c.text }}>{isDayDone ? "Day done ✓" : "Mark day as done"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorBanner: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginHorizontal: 16 },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  brand: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  brandText: { fontSize: 12, fontWeight: "600" },
  datetime: { fontSize: 12 },
  expandBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },

  heroArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 16 },
  heroPct: { fontSize: 42, fontWeight: "800", letterSpacing: -1 },
  heroWorked: { fontSize: 14, marginTop: 2 },
  heroHeadline: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5, textAlign: "center" },
  heroSubtext: { fontSize: 15, textAlign: "center", lineHeight: 20 },
  statsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "center", gap: 6 },
  statText: { fontSize: 14 },
  statDivider: { fontSize: 14 },

  bottomBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chipLabel: { fontSize: 12, fontWeight: "600" },
  offDot: { width: 7, height: 7, borderRadius: 4 },
  pillBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  pillBtnText: { fontSize: 14, fontWeight: "600" },
  clockBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999 },
  clockBtnText: { fontSize: 15, fontWeight: "700" },

  exScroll: { padding: 16, gap: 12 },
  exCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10, ...(Platform.OS === "android" ? { elevation: 2 } : { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 }) },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  stat: { paddingLeft: 10, borderLeftWidth: 3, gap: 2, marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  statValue: { fontSize: 17, fontWeight: "700" },
  addRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 12, paddingRight: 6, gap: 8 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  dayDoneBtn: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, alignItems: "center" },
});
