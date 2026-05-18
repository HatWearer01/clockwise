import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as SessionService from "../../src/services/session";
import * as InsightService from "../../src/services/insight";
import * as TaskService from "../../src/services/task";
import { useSettingsStore } from "../../src/store/settings";
import { useTimerStore } from "../../src/store/timer";
import { getColors } from "../../src/lib/theme";
import type { DailyTask, Insight, StatsSummary, WeekDaySummary, WeeklyReview } from "../../src/types";
import {
  formatDecimalHours,
  formatHoursMinutes,
  formatMinuteAsTime,
  pct,
  todayISODate,
  weekDayDates,
  weekRangeLabel,
} from "../../src/lib/time";

type ViewMode = "week" | "history";

function navigateWeekOffsetForStart(startDate: string, wsd: 0 | 1): number {
  const today = new Date();
  const todayDow = today.getDay();
  const diff = (todayDow - (wsd === 0 ? 0 : 1) + 7) % 7;
  const thisWeekAnchor = new Date(today);
  thisWeekAnchor.setDate(today.getDate() - diff);
  thisWeekAnchor.setHours(0, 0, 0, 0);

  const target = new Date(startDate + "T00:00:00");
  const diffMs = target.getTime() - thisWeekAnchor.getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function insightSeverityStyle(c: ReturnType<typeof getColors>, severity: Insight["severity"]) {
  if (severity === "warning") {
    return { bg: c.warning + "18", border: c.warning + "55", accent: c.warning };
  }
  if (severity === "positive") {
    return { bg: c.positive + "18", border: c.positive + "55", accent: c.positive };
  }
  return { bg: c.accent + "14", border: c.accent + "44", accent: c.accent };
}

export default function WeekScreen() {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const appSettings = useSettingsStore((s) => s.appSettings);
  const wsd = appSettings.week_start_day as 0 | 1;
  const tf = appSettings.time_format;
  const isShiftMode = appSettings.accountability_mode === "shift";
  const refreshStatus = useTimerStore((s) => s.refreshStatus);

  const c = getColors(resolvedTheme);
  const cardBorder = resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : c.border;
  const hairline = resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : c.border;
  const styles = useMemo(() => makeStyles(c), [resolvedTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [days, setDays] = useState<WeekDaySummary[] | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [dayTasks, setDayTasks] = useState<DailyTask[]>([]);
  const [weekTaskCounts, setWeekTaskCounts] = useState<Record<string, { total: number; done: number }>>({});
  const [weekDone, setWeekDone] = useState(false);

  const allWeekDays = useMemo(() => weekDayDates(weekOffset, wsd), [weekOffset, wsd]);
  const weekStart = allWeekDays[0]?.date ?? "";
  const isCurrentWeek = weekOffset === 0;
  const todayDow = new Date().getDay();
  const isoToday = todayISODate();

  const loadWeekData = useCallback(async () => {
    if (!weekStart) return;
    setLoading(true);
    setError(null);
    try {
      const common = [
        SessionService.getWeekSummary(weekStart, wsd),
        SessionService.getStatsSummary(wsd),
        InsightService.getInsights(wsd),
        SessionService.getWeeklyReview(wsd, weekStart),
      ] as const;
      const weekDoneP = isCurrentWeek ? SessionService.isWeekDone() : Promise.resolve(false);
      const [weekSummary, statsSummary, insightList, weeklyReview, doneNow] = await Promise.all([
        ...common,
        weekDoneP,
      ]);
      setDays(weekSummary);
      setStats(statsSummary);
      setInsights(insightList);
      setReview(weeklyReview);
      setWeekDone(doneNow);
    } catch (e) {
      setError(
        typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : "Failed to load week data",
      );
      setDays(null);
    } finally {
      setLoading(false);
    }
  }, [weekStart, wsd, isCurrentWeek]);

  useEffect(() => {
    void loadWeekData();
  }, [loadWeekData]);

  useEffect(() => {
    setExpandedDay(null);
    setDayTasks([]);
  }, [weekOffset]);

  useEffect(() => {
    if (!isShiftMode || !weekStart || viewMode !== "week") {
      setWeekTaskCounts({});
      return;
    }
    TaskService.getTasksForWeek(weekStart)
      .then((resp) => {
        const counts: Record<string, { total: number; done: number }> = {};
        for (const [date, tasks] of Object.entries(resp.days)) {
          counts[date] = { total: tasks.length, done: tasks.filter((t) => t.done).length };
        }
        setWeekTaskCounts(counts);
      })
      .catch(() => setWeekTaskCounts({}));
  }, [weekStart, isShiftMode, viewMode]);

  const toggleExpandDay = useCallback(async (date: string) => {
    if (expandedDay === date) {
      setExpandedDay(null);
      setDayTasks([]);
      return;
    }
    setExpandedDay(date);
    try {
      const tasks = await TaskService.getDailyTasks(date);
      setDayTasks(tasks ?? []);
    } catch {
      setDayTasks([]);
    }
  }, [expandedDay]);

  const handleRolloverToToday = useCallback(
    async (taskId: number) => {
      try {
        await TaskService.rolloverDailyTask(taskId, isoToday);
        if (expandedDay) {
          const tasks = await TaskService.getDailyTasks(expandedDay);
          setDayTasks(tasks ?? []);
        }
      } catch {
        /* ignore */
      }
    },
    [expandedDay, isoToday],
  );

  const totalPlanned = days?.reduce((s, d) => s + d.planned_ms, 0) ?? 0;
  const totalActual = days?.reduce((s, d) => s + d.actual_ms, 0) ?? 0;
  const totalCoverage = days?.reduce((s, d) => s + d.shift_coverage_ms, 0) ?? 0;
  const remainingMs = Math.max(0, totalPlanned - totalActual);
  const daysWorked = days?.filter((d) => d.actual_ms > 60_000).length ?? 0;
  const daysPlanned = days?.filter((d) => d.planned_ms > 0).length ?? 0;
  const completion = pct(totalActual, totalPlanned);
  const isOver = totalActual > totalPlanned && totalPlanned > 0;

  const weekTaskTotal = Object.values(weekTaskCounts).reduce((s, x) => s + x.total, 0);
  const weekTaskDone = Object.values(weekTaskCounts).reduce((s, x) => s + x.done, 0);

  const todayWeekIndex = todayDow === 0 ? 6 : todayDow - 1;
  const daysLeft =
    isCurrentWeek && days
      ? days.filter((d, i) => i >= todayWeekIndex && d.planned_ms > 0).length
      : 0;

  const maxWeekWorked = stats ? Math.max(...stats.week_points.map((w) => w.worked_ms), 1) : 1;
  const chartWeeks = stats?.week_points ?? [];

  const navigateToWeekStart = useCallback(
    (startDate: string) => {
      setWeekOffset(navigateWeekOffsetForStart(startDate, wsd));
      setViewMode("week");
    },
    [wsd],
  );

  const headerTitle =
    viewMode === "week" ? (isCurrentWeek ? "This week" : "Week view") : "Past weeks";

  if (loading && !days && !error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} />
          <Text style={[styles.muted, { marginTop: 12 }]}>Loading week…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !days) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.errorText, { color: c.error }]}>{error}</Text>
          <TouchableOpacity style={[styles.retryBtn, { borderColor: c.primary }]} onPress={() => void loadWeekData()}>
            <Text style={{ color: c.primary, fontWeight: "600" }}>Retry</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.text }]}>{headerTitle}</Text>
            {viewMode === "week" ? (
              <Text style={[styles.subtitle, { color: c.textMuted }]}>{weekRangeLabel(weekOffset, wsd)}</Text>
            ) : (
              <Text style={[styles.subtitle, { color: c.textMuted }]}>Monthly totals and weekly history</Text>
            )}
          </View>
        </View>

        <View style={styles.segmentWrap}>
          <View style={[styles.segment, { borderColor: cardBorder, backgroundColor: c.surface }]}>
            <Pressable
              style={[styles.segmentItem, viewMode === "week" && { backgroundColor: c.primary + "28" }]}
              onPress={() => setViewMode("week")}
            >
              <Text style={[styles.segmentLabel, { color: viewMode === "week" ? c.primary : c.textSecondary }]}>
                Week
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentItem, viewMode === "history" && { backgroundColor: c.primary + "28" }]}
              onPress={() => setViewMode("history")}
            >
              <Text style={[styles.segmentLabel, { color: viewMode === "history" ? c.primary : c.textSecondary }]}>
                History
              </Text>
            </Pressable>
          </View>
        </View>

        {viewMode === "week" ? (
          <>
            <View style={[styles.weekNav, { borderColor: hairline }]}>
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: c.surface }]}
                onPress={() => setWeekOffset((o) => o - 1)}
                accessibilityLabel="Previous week"
              >
                <Ionicons name="chevron-back" size={22} color={c.text} />
              </TouchableOpacity>
              <View style={styles.weekNavCenter}>
                <Text style={[styles.weekRange, { color: c.text }]}>{weekRangeLabel(weekOffset, wsd)}</Text>
                {!isCurrentWeek ? (
                  <TouchableOpacity onPress={() => setWeekOffset(0)} hitSlop={8}>
                    <Text style={[styles.todayLink, { color: c.primary }]}>This week</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: c.surface }]}
                onPress={() => setWeekOffset((o) => o + 1)}
                accessibilityLabel="Next week"
              >
                <Ionicons name="chevron-forward" size={22} color={c.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Stats summary</Text>
            <View style={styles.statsGrid}>
              {isShiftMode ? (
                <>
                  <StatTile
                    label="Hours logged"
                    value={formatHoursMinutes(totalActual)}
                    hint={`of ${formatHoursMinutes(totalPlanned)} planned · ${formatHoursMinutes(totalCoverage)} in shift`}
                    colors={c}
                    cardBorder={cardBorder}
                    styles={styles}
                  />
                  <StatTile
                    label="Tasks"
                    value={`${weekTaskDone} / ${weekTaskTotal}`}
                    hint="done this week"
                    colors={c}
                    cardBorder={cardBorder}
                    styles={styles}
                  />
                  <StatTile
                    label="Days worked"
                    value={`${daysWorked} / ${daysPlanned}`}
                    hint={weekDone ? "Week done" : `${completion}% of planned hours`}
                    colors={c}
                    cardBorder={cardBorder}
                    styles={styles}
                  />
                </>
              ) : (
                <>
                  <StatTile
                    label="Hours logged"
                    value={formatHoursMinutes(totalActual)}
                    hint={`of ${formatHoursMinutes(totalPlanned)} planned`}
                    colors={c}
                    cardBorder={cardBorder}
                    styles={styles}
                  />
                  <StatTile
                    label={
                      weekDone ? "Week complete" : isOver ? "Overtime" : "Still need"
                    }
                    value={
                      weekDone
                        ? formatHoursMinutes(totalActual)
                        : isOver
                          ? `+${formatHoursMinutes(totalActual - totalPlanned)}`
                          : formatHoursMinutes(remainingMs)
                    }
                    hint={
                      weekDone
                        ? "done early"
                        : isOver
                          ? "over target"
                          : daysLeft > 0
                            ? `across ${daysLeft} remaining day${daysLeft === 1 ? "" : "s"}`
                            : "to hit target"
                    }
                    colors={c}
                    cardBorder={cardBorder}
                    styles={styles}
                  />
                  <StatTile
                    label="Days worked"
                    value={`${daysWorked} / ${daysPlanned}`}
                    hint={weekDone ? "Week done" : `${completion}% complete`}
                    colors={c}
                    cardBorder={cardBorder}
                    styles={styles}
                  />
                </>
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Day breakdown</Text>
            <View style={[styles.cardElevated, { backgroundColor: c.surface, borderColor: cardBorder }]}>
              {(days ?? []).map((day, idx) => {
                const progress = pct(day.actual_ms, day.planned_ms);
                const isOff = day.planned_ms === 0;
                const isToday = isCurrentWeek && day.day_of_week === todayDow;
                const dayOver = day.actual_ms > day.planned_ms && day.planned_ms > 0;
                const barPct = day.planned_ms > 0 ? Math.min(100, progress) : 0;
                const actualColor = dayOver ? c.warning : c.primary;
                const dayDate = allWeekDays[idx]?.date ?? "";
                const isExpanded = expandedDay === dayDate;
                const dtc = weekTaskCounts[dayDate];

                return (
                  <View key={`${day.day_of_week}-${idx}`}>
                    <Pressable
                      onPress={() => void toggleExpandDay(dayDate)}
                      style={({ pressed }) => [
                        styles.dayCardRow,
                        idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hairline },
                        pressed && { backgroundColor: c.surfaceAlt },
                        isToday && { backgroundColor: c.primary + "0d" },
                        isOff && { opacity: 0.85 },
                      ]}
                    >
                      <View style={styles.dayRowMain}>
                        <View style={styles.dayLabelCol}>
                          <Text style={[styles.dayName, { color: c.text }]}>
                            {day.label}
                            {isToday ? (
                              <Text style={{ color: c.primary, fontWeight: "700" }}> · today</Text>
                            ) : null}
                          </Text>
                          <Text style={[styles.dayHours, { color: c.textMuted }]} numberOfLines={2}>
                            {isOff
                              ? day.actual_ms > 60_000
                                ? `Off · ${formatHoursMinutes(day.actual_ms)} worked${dtc ? ` · ${dtc.done}/${dtc.total} tasks` : ""}`
                                : `Off${dtc ? ` · ${dtc.done}/${dtc.total} tasks` : ""}`
                              : isShiftMode
                                ? `${formatHoursMinutes(day.actual_ms)} / ${formatHoursMinutes(day.planned_ms)}${
                                    day.shift_coverage_ms < day.actual_ms
                                      ? ` (${formatHoursMinutes(day.shift_coverage_ms)} in shift)`
                                      : ""
                                  }${dtc ? ` · ${dtc.done}/${dtc.total} tasks` : ""}`
                                : `${formatHoursMinutes(day.actual_ms)} / ${formatHoursMinutes(day.planned_ms)}`}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.barTrack, { backgroundColor: c.bg }]}>
                        {day.planned_ms > 0 ? (
                          <>
                            <View
                              pointerEvents="none"
                              style={[StyleSheet.absoluteFillObject, styles.barPlannedFill, { backgroundColor: c.border }]}
                            />
                            <View
                              pointerEvents="none"
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${barPct}%`,
                                backgroundColor: actualColor,
                                borderRadius: 999,
                              }}
                            />
                          </>
                        ) : day.actual_ms > 60_000 ? (
                          <View
                            pointerEvents="none"
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: `${Math.min(100, Math.round((day.actual_ms / (8 * 3600_000)) * 100))}%`,
                              backgroundColor: c.accent,
                              borderRadius: 999,
                            }}
                          />
                        ) : (
                          <View style={[styles.barOffTrack, { borderColor: hairline }]} />
                        )}
                      </View>
                      <View style={styles.expandChevron}>
                        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
                      </View>
                    </Pressable>
                    {isExpanded ? (
                      <View style={[styles.dayTasksPanel, { borderTopColor: hairline }]}>
                        {dayTasks.length === 0 ? (
                          <Text style={[styles.dayTasksEmpty, { color: c.textMuted }]}>No tasks for this day.</Text>
                        ) : (
                          dayTasks.map((task) => (
                            <View key={task.id} style={styles.taskLine}>
                              <Text style={[styles.taskBullet, { color: task.done ? c.primary : c.textMuted }]}>
                                {task.done ? "✓" : "○"}
                              </Text>
                              <Text
                                style={[
                                  styles.taskLineText,
                                  { color: task.done ? c.textMuted : c.text },
                                  task.done && styles.taskDone,
                                ]}
                              >
                                {task.recurring_task_id != null ? (
                                  <Text style={{ color: c.accent }}>↻ </Text>
                                ) : null}
                                {task.text}
                              </Text>
                              {!task.done && !task.recurring_task_id && dayDate !== isoToday ? (
                                <TouchableOpacity
                                  onPress={() => void handleRolloverToToday(task.id)}
                                  style={[styles.rolloverChip, { borderColor: c.border }]}
                                >
                                  <Text style={[styles.rolloverChipText, { color: c.primary }]}>→ Today</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          ))
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {isCurrentWeek && totalPlanned > 0 ? (
              <TouchableOpacity
                style={[
                  styles.weekDoneBtn,
                  {
                    borderColor: weekDone ? c.primary : cardBorder,
                    backgroundColor: weekDone ? c.primary + "22" : c.surface,
                  },
                ]}
                onPress={async () => {
                  const next = !weekDone;
                  await SessionService.markWeekDone(next);
                  setWeekDone(next);
                  void refreshStatus();
                }}
                activeOpacity={0.85}
              >
                <Ionicons name={weekDone ? "checkmark-circle" : "ellipse-outline"} size={22} color={c.primary} />
                <Text style={[styles.weekDoneBtnText, { color: c.text }]}>
                  {weekDone ? "Week done" : "Done for the week"}
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.expandHeader, { backgroundColor: c.surface, borderColor: cardBorder }]}
              onPress={() => setReviewOpen((v) => !v)}
              activeOpacity={0.85}
            >
              <View>
                <Text style={[styles.sectionTitleInline, { color: c.text }]}>Weekly review</Text>
                <Text style={[styles.reviewHint, { color: c.textMuted }]}>Prior week summary · tap to expand</Text>
              </View>
              <Ionicons name={reviewOpen ? "chevron-up" : "chevron-down"} size={22} color={c.textSecondary} />
            </TouchableOpacity>
            {reviewOpen && review ? (
              <View style={[styles.cardElevated, { backgroundColor: c.surface, borderColor: cardBorder, marginTop: 8 }]}>
                <Text style={[styles.reviewWeekLabel, { color: c.textSecondary }]}>{review.week_label}</Text>

                <View style={styles.kpiGrid}>
                  <ReviewKpi label="Days worked" value={`${review.days_worked} / ${review.days_scheduled}`} c={c} />
                  <ReviewKpi label="On-time days" value={String(review.on_time_days)} c={c} />
                  <ReviewKpi label="Off-schedule" value={String(review.off_schedule_sessions)} c={c} />
                  <ReviewKpi label="Logged" value={formatHoursMinutes(review.total_actual_ms)} c={c} />
                  <ReviewKpi label="Target" value={formatHoursMinutes(review.total_target_ms)} c={c} />
                </View>

                {(review.avg_start_minute != null || review.avg_end_minute != null) && (
                  <View style={[styles.reviewAverages, { backgroundColor: c.bg }]}>
                    <Text style={[styles.detailHeading, { color: c.textMuted }]}>Week averages</Text>
                    <Text style={[styles.detailLine, { color: c.text }]}>
                      Start{" "}
                      {review.avg_start_minute != null ? formatMinuteAsTime(review.avg_start_minute, tf) : "—"} · End{" "}
                      {review.avg_end_minute != null ? formatMinuteAsTime(review.avg_end_minute, tf) : "—"}
                    </Text>
                  </View>
                )}

                <Text style={[styles.detailHeading, { color: c.textMuted, marginTop: 16 }]}>Day by day</Text>
                <View style={[styles.tableHeader, { borderBottomColor: hairline }]}>
                  <Text style={[styles.th, { color: c.textMuted, flex: 0.22 }]}>Day</Text>
                  <Text style={[styles.th, { color: c.textMuted, flex: 0.38 }]}>Logged / target</Text>
                  <Text style={[styles.th, { color: c.textMuted, flex: 0.28, textAlign: "right" }]}>Status</Text>
                </View>
                {review.day_details.map((d) => (
                  <View key={d.label} style={[styles.tableRow, { borderBottomColor: hairline }]}>
                    <Text style={[styles.tdDay, { color: c.text }]}>{d.label}</Text>
                    <Text style={[styles.tdMeta, { color: c.textSecondary }]}>
                      {formatHoursMinutes(d.actual_ms)} / {formatHoursMinutes(d.target_ms)}
                    </Text>
                    <Text style={[styles.tdStatus, { color: d.on_time ? c.positive : c.textMuted }]}>
                      {d.on_time ? "On time" : "—"}
                    </Text>
                  </View>
                ))}

                {review.insights.length > 0 ? (
                  <>
                    <Text style={[styles.detailHeading, { color: c.textMuted, marginTop: 18 }]}>Review insights</Text>
                    {review.insights.map((ins, idx) => {
                      const sev = insightSeverityStyle(c, ins.severity);
                      return (
                        <View
                          key={`${ins.kind}-${idx}`}
                          style={[styles.miniInsight, { backgroundColor: sev.bg, borderColor: sev.border }]}
                        >
                          <View style={[styles.miniInsightDot, { backgroundColor: sev.accent }]} />
                          <Text style={[styles.miniInsightText, { color: c.textSecondary }]}>{ins.message}</Text>
                        </View>
                      );
                    })}
                  </>
                ) : null}
              </View>
            ) : null}

            <Text style={[styles.sectionTitle, { color: c.textSecondary, marginTop: 8 }]}>Insights</Text>
            {insights.length === 0 ? (
              <View style={[styles.emptyInsights, { borderColor: cardBorder, backgroundColor: c.surface }]}>
                <Text style={[styles.muted, { textAlign: "center" }]}>No insights right now.</Text>
              </View>
            ) : (
              <View style={styles.insightCardList}>
                {insights.map((ins, idx) => {
                  const sev = insightSeverityStyle(c, ins.severity);
                  return (
                    <View
                      key={`${ins.kind}-${idx}`}
                      style={[styles.insightCard, { backgroundColor: sev.bg, borderColor: sev.border }]}
                    >
                      <View style={[styles.insightAccentBar, { backgroundColor: sev.accent }]} />
                      <Text style={[styles.insightCardText, { color: c.text }]}>{ins.message}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Overview</Text>
            <View style={styles.statsGrid}>
              <StatTile
                label="This month"
                value={formatHoursMinutes(stats?.month_total_ms ?? 0)}
                hint="total logged"
                colors={c}
                cardBorder={cardBorder}
                styles={styles}
              />
              {stats?.avg_start_minute != null ? (
                <StatTile
                  label="Avg clock-in"
                  value={formatMinuteAsTime(stats.avg_start_minute, tf)}
                  hint="last 60 days"
                  colors={c}
                  cardBorder={cardBorder}
                  styles={styles}
                />
              ) : null}
              {stats?.avg_end_minute != null ? (
                <StatTile
                  label="Avg clock-out"
                  value={formatMinuteAsTime(stats.avg_end_minute, tf)}
                  hint="last 60 days"
                  colors={c}
                  cardBorder={cardBorder}
                  styles={styles}
                />
              ) : null}
            </View>

            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Last 8 weeks</Text>
            <Text style={[styles.chartCaption, { color: c.textMuted }]}>
              Tap a bar to open that week in Week view.
            </Text>
            <View style={[styles.chartCard, { backgroundColor: c.surface, borderColor: cardBorder }]}>
              <View style={[styles.chartRow, { alignItems: "flex-end" }]}>
                {chartWeeks.map((wp, i) => {
                  const barH = Math.max(6, Math.round((wp.worked_ms / maxWeekWorked) * 132));
                  const isLatest = i === chartWeeks.length - 1;
                  return (
                    <TouchableOpacity
                      key={wp.week_label + wp.week_start_date}
                      style={styles.barCol}
                      onPress={() => navigateToWeekStart(wp.week_start_date)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.barValue, { color: c.textSecondary }]} numberOfLines={1}>
                        {wp.worked_ms > 0 ? formatDecimalHours(wp.worked_ms) : "—"}
                      </Text>
                      <View style={styles.barSlot}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: barH,
                              backgroundColor: isLatest ? c.primary : c.surfaceAlt,
                              borderWidth: isLatest ? 0 : StyleSheet.hairlineWidth,
                              borderColor: cardBorder,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.barLabel, { color: c.textMuted }]} numberOfLines={1}>
                        {wp.week_label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {error ? <Text style={[styles.bannerError, { color: c.error }]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({
  label,
  value,
  hint,
  colors: col,
  cardBorder,
  styles,
}: {
  label: string;
  value: string;
  hint: string;
  colors: ReturnType<typeof getColors>;
  cardBorder: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: col.surface, borderColor: cardBorder }]}>
      <Text style={[styles.statLabel, { color: col.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: col.text }]} numberOfLines={2}>
        {value}
      </Text>
      <Text style={[styles.statHint, { color: col.textMuted }]}>{hint}</Text>
    </View>
  );
}

function ReviewKpi({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof getColors>;
}) {
  return (
    <View style={[reviewKpiStyles.cell, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[reviewKpiStyles.kpiLabel, { color: c.textMuted }]}>{label}</Text>
      <Text style={[reviewKpiStyles.kpiValue, { color: c.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const reviewKpiStyles = StyleSheet.create({
  cell: {
    width: "48%",
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  kpiLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  kpiValue: { fontSize: 17, fontWeight: "800", marginTop: 4 },
});

function makeStyles(c: ReturnType<typeof getColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 16, paddingBottom: 36 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center" },
    topHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
    title: { fontSize: 26, fontWeight: "800" },
    subtitle: { fontSize: 13, marginTop: 4 },
    segmentWrap: { marginBottom: 14 },
    segment: {
      flexDirection: "row",
      borderRadius: 12,
      borderWidth: 1,
      padding: 3,
      gap: 4,
    },
    segmentItem: { flex: 1, borderRadius: 9, paddingVertical: 10, alignItems: "center" },
    segmentLabel: { fontSize: 14, fontWeight: "700" },
    weekNav: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      marginBottom: 18,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      ...Platform.select({
        android: { elevation: 1 },
        default: {},
      }),
    },
    weekNavCenter: { alignItems: "center", flex: 1, paddingHorizontal: 8 },
    weekRange: { fontSize: 15, fontWeight: "700", textAlign: "center" },
    todayLink: { fontSize: 13, fontWeight: "600", marginTop: 4 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: 10,
      marginTop: 4,
    },
    sectionTitleInline: { fontSize: 17, fontWeight: "800" },
    reviewHint: { fontSize: 12, marginTop: 4 },
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 6 },
    statTile: {
      width: "48%",
      flexGrow: 1,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      ...Platform.select({
        android: { elevation: 2 },
        default: {},
      }),
    },
    statLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.35, textTransform: "uppercase" },
    statValue: { fontSize: 22, fontWeight: "800", marginTop: 6 },
    statHint: { fontSize: 11, marginTop: 8, lineHeight: 15 },
    cardElevated: {
      borderRadius: 14,
      borderWidth: 1,
      overflow: "hidden",
      marginBottom: 16,
      ...Platform.select({
        android: { elevation: 3 },
        default: {},
      }),
    },
    dayCardRow: { paddingVertical: 14, paddingHorizontal: 12, paddingRight: 36 },
    dayRowMain: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
    dayLabelCol: { flex: 1, paddingRight: 8 },
    dayName: { fontSize: 16, fontWeight: "700" },
    dayHours: { fontSize: 12, marginTop: 4, lineHeight: 17 },
    barTrack: {
      height: 10,
      borderRadius: 999,
      overflow: "hidden",
      position: "relative",
    },
    barPlannedFill: { opacity: 0.28, borderRadius: 999 },
    barOffTrack: {
      flex: 1,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
    },
    expandChevron: { position: "absolute", right: 10, top: 18 },
    dayTasksPanel: {
      paddingHorizontal: 12,
      paddingBottom: 14,
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    dayTasksEmpty: { fontSize: 13, paddingVertical: 8, paddingLeft: 4 },
    taskLine: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 8, paddingLeft: 4 },
    taskBullet: { width: 18, textAlign: "center", fontSize: 13, marginTop: 1 },
    taskLineText: { flex: 1, fontSize: 14, lineHeight: 20 },
    taskDone: { textDecorationLine: "line-through" },
    rolloverChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    rolloverChipText: { fontSize: 11, fontWeight: "700" },
    weekDoneBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      alignSelf: "flex-start",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 16,
    },
    weekDoneBtnText: { fontSize: 15, fontWeight: "700" },
    expandHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 0,
    },
    reviewWeekLabel: { fontSize: 14, fontWeight: "700", marginBottom: 12, paddingHorizontal: 14, paddingTop: 14 },
    kpiGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      paddingHorizontal: 14,
      marginBottom: 4,
    },
    reviewAverages: { marginHorizontal: 14, padding: 12, borderRadius: 12, marginTop: 8 },
    detailHeading: {
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.45,
      paddingHorizontal: 14,
    },
    detailLine: { fontSize: 14, paddingHorizontal: 14, marginTop: 6 },
    tableHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginTop: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    th: { fontSize: 11, fontWeight: "800", letterSpacing: 0.35 },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tdDay: { flex: 0.22, fontWeight: "700", fontSize: 14 },
    tdMeta: { flex: 0.38, fontSize: 13 },
    tdStatus: { flex: 0.28, fontSize: 12, fontWeight: "800", textAlign: "right" },
    miniInsight: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginHorizontal: 14,
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
    },
    miniInsightDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
    miniInsightText: { flex: 1, fontSize: 13, lineHeight: 19 },
    emptyInsights: {
      borderWidth: 1,
      borderRadius: 14,
      paddingVertical: 20,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    insightCardList: { gap: 10, marginBottom: 8 },
    insightCard: {
      borderRadius: 14,
      borderWidth: 1,
      overflow: "hidden",
      flexDirection: "row",
      ...Platform.select({
        android: { elevation: 2 },
        default: {},
      }),
    },
    insightAccentBar: { width: 4 },
    insightCardText: { flex: 1, fontSize: 14, lineHeight: 21, paddingVertical: 14, paddingRight: 14 },
    chartCaption: { fontSize: 12, marginBottom: 10 },
    chartCard: {
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingTop: 14,
      paddingBottom: 12,
      marginBottom: 12,
      ...Platform.select({
        android: { elevation: 2 },
        default: {},
      }),
    },
    chartRow: { flexDirection: "row", justifyContent: "space-between", gap: 4, minHeight: 168 },
    barCol: { flex: 1, alignItems: "center", maxWidth: 52 },
    barValue: { fontSize: 10, fontWeight: "700", marginBottom: 6 },
    barSlot: { flex: 1, justifyContent: "flex-end", alignItems: "center", width: "100%", minHeight: 132 },
    bar: { width: "70%", borderRadius: 6, minHeight: 4 },
    barLabel: { fontSize: 10, marginTop: 8, textAlign: "center", fontWeight: "600" },
    muted: { color: c.textMuted, fontSize: 14 },
    errorText: { fontSize: 15, textAlign: "center", marginBottom: 16 },
    retryBtn: { alignSelf: "center", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
    bannerError: { marginTop: 12, fontSize: 13, textAlign: "center" },
  });
}
