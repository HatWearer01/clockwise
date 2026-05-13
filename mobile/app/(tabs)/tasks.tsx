import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSettingsStore } from "../../src/store/settings";
import { getColors } from "../../src/lib/theme";
import * as TaskService from "../../src/services/task";
import { todayISODate, weekDayDates, weekRangeLabel } from "../../src/lib/time";
import type { DailyTask, RecurrenceType, RecurringTask } from "../../src/types";

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  daily: "Every day",
  weekdays: "Weekdays (Mon–Fri)",
  specific_days: "Specific days",
  weekly: "Weekly",
  every_n_days: "Every N days",
};

const RECURRENCE_ORDER: RecurrenceType[] = [
  "daily",
  "weekdays",
  "specific_days",
  "weekly",
  "every_n_days",
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extractError(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return fallback;
}

function recurrenceDescription(rt: RecurringTask): string {
  if (rt.recurrence_type === "specific_days" && rt.recurrence_days) {
    const labels = rt.recurrence_days.split(",").map((s) => DOW_LABELS[parseInt(s)] ?? s.trim());
    return labels.join(", ");
  }
  if (rt.recurrence_type === "every_n_days" && rt.interval_days) {
    return `Every ${rt.interval_days} days`;
  }
  return RECURRENCE_LABELS[rt.recurrence_type] ?? rt.recurrence_type;
}

export default function TasksScreen() {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const wsd = useSettingsStore((s) => s.appSettings.week_start_day as 0 | 1);
  const c = getColors(resolvedTheme);

  const isoToday = todayISODate();
  const [weekOffset, setWeekOffset] = useState(0);
  const allWeekDays = weekDayDates(weekOffset, wsd);
  const isPastWeek = weekOffset < 0;

  const [selectedDate, setSelectedDate] = useState(isoToday);
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekData, setWeekData] = useState<Awaited<ReturnType<typeof TaskService.getTasksForWeek>> | null>(null);

  const [newTaskText, setNewTaskText] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [rolloverTaskId, setRolloverTaskId] = useState<number | null>(null);

  const [recurringModalOpen, setRecurringModalOpen] = useState(false);
  const [recurringTasks, setRecurringTasks] = useState<RecurringTask[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [newRecText, setNewRecText] = useState("");
  const [newRecType, setNewRecType] = useState<RecurrenceType>("daily");
  const [newRecDays, setNewRecDays] = useState<number[]>([]);
  const [newRecInterval, setNewRecInterval] = useState(2);
  const [newRecStartDate, setNewRecStartDate] = useState(isoToday);
  const [newRecEndDate, setNewRecEndDate] = useState("");
  const [editRecId, setEditRecId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [recurrencePickerOpen, setRecurrencePickerOpen] = useState(false);

  const loadWeek = useCallback(async () => {
    const start = weekDayDates(weekOffset, wsd)[0]?.date;
    if (!start) return;
    setWeekLoading(true);
    try {
      const data = await TaskService.getTasksForWeek(start);
      setWeekData(data);
    } catch (e) {
      console.error("[TasksScreen] loadWeek failed:", e);
      setWeekData(null);
    } finally {
      setWeekLoading(false);
    }
  }, [weekOffset, wsd]);

  const loadRecurring = useCallback(async () => {
    setRecurringLoading(true);
    try {
      const list = await TaskService.getRecurringTasks();
      setRecurringTasks(list);
    } catch (e) {
      console.error("[TasksScreen] loadRecurring failed:", e);
    } finally {
      setRecurringLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    const days = weekDayDates(weekOffset, wsd);
    const dayInWeek = days.find((d) => d.date === isoToday);
    if (weekOffset === 0 && dayInWeek) {
      setSelectedDate(isoToday);
    } else {
      setSelectedDate(days[0]?.date ?? isoToday);
    }
    setRolloverTaskId(null);
    setEditingId(null);
    setExpandedTaskId(null);
    setSubtaskDraft("");
  }, [weekOffset, wsd, isoToday]);

  useEffect(() => {
    if (recurringModalOpen) {
      void loadRecurring();
    }
  }, [recurringModalOpen, loadRecurring]);

  const tasks: DailyTask[] = weekData?.days[selectedDate] ?? [];
  const isToday = selectedDate === isoToday;
  const selectedDayLabel = allWeekDays.find((d) => d.date === selectedDate)?.label ?? selectedDate;
  const doneCount = tasks.filter((t) => t.done).length;
  const recurringStats = weekData?.recurring_stats ?? {};
  const cardBorder = resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : c.border;
  const hairlineBorder = resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : c.border;
  const onPrimary = resolvedTheme === "dark" ? "#0f1422" : "#ffffff";
  const pillLabelOnPrimary = onPrimary;

  const rolloverTargets = weekDayDates(0, wsd).filter((d) => d.date !== selectedDate);

  async function handleAdd() {
    const text = newTaskText.trim();
    if (!text || isPastWeek) return;
    try {
      await TaskService.addDailyTask(selectedDate, text);
      setNewTaskText("");
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  async function handleToggle(id: number, done: boolean) {
    try {
      await TaskService.toggleDailyTask(id, done);
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(id: number) {
    try {
      await TaskService.deleteDailyTask(id);
      setExpandedTaskId((x) => (x === id ? null : x));
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  async function handleRollover(id: number, targetDate: string) {
    try {
      await TaskService.rolloverDailyTask(id, targetDate);
      setRolloverTaskId(null);
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  async function finishEdit(task: DailyTask) {
    if (editingId !== task.id) return;
    const text = editText.trim();
    setEditingId(null);
    setEditText("");
    if (!text || text === task.text) return;
    try {
      await TaskService.updateDailyTask(task.id, text);
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  function toggleDowSelection(d: number) {
    setNewRecDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function handleAddRecurring() {
    const text = newRecText.trim();
    if (!text) return;
    setRecError(null);
    if (!ISO_DATE_RE.test(newRecStartDate)) {
      setRecError("Start date must be YYYY-MM-DD.");
      return;
    }
    const daysStr =
      newRecType === "specific_days" ? [...newRecDays].sort((a, b) => a - b).join(",") : null;
    const interval = newRecType === "every_n_days" ? newRecInterval : null;
    const endDate = newRecEndDate.trim() ? newRecEndDate.trim() : null;
    if (endDate && !ISO_DATE_RE.test(endDate)) {
      setRecError("End date must be YYYY-MM-DD or blank.");
      return;
    }
    if (newRecType === "specific_days" && (!daysStr || daysStr === "")) {
      setRecError("Pick at least one weekday.");
      return;
    }
    try {
      await TaskService.addRecurringTask(text, newRecType, daysStr, interval, newRecStartDate, endDate);
      setNewRecText("");
      setNewRecType("daily");
      setNewRecDays([]);
      setNewRecInterval(2);
      setNewRecStartDate(isoToday);
      setNewRecEndDate("");
      await loadRecurring();
      await loadWeek();
    } catch (e) {
      setRecError(extractError(e, "Failed to add recurring task"));
    }
  }

  async function handleToggleRecActive(rt: RecurringTask) {
    setRecError(null);
    try {
      await TaskService.updateRecurringTask(
        rt.id,
        rt.text,
        rt.recurrence_type,
        rt.recurrence_days,
        rt.interval_days,
        rt.end_date,
        !rt.active
      );
      await loadRecurring();
      await loadWeek();
    } catch (e) {
      setRecError(extractError(e, "Failed to update task"));
    }
  }

  async function handleDeleteRecurring(id: number, deleteInstances: boolean) {
    setRecError(null);
    setDeleteConfirmId(null);
    try {
      await TaskService.deleteRecurringTask(id, deleteInstances);
      await loadRecurring();
      await loadWeek();
    } catch (e) {
      setRecError(extractError(e, "Failed to delete task"));
    }
  }

  async function handleAddSubtask(taskId: number) {
    const text = subtaskDraft.trim();
    if (!text || isPastWeek) return;
    try {
      await TaskService.addSubtask(taskId, text);
      setSubtaskDraft("");
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  async function handleToggleSubtask(subId: number, done: boolean) {
    try {
      await TaskService.toggleSubtask(subId, done);
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  async function handleDeleteSubtask(subId: number) {
    try {
      await TaskService.deleteSubtask(subId);
      await loadWeek();
    } catch {
      /* ignore */
    }
  }

  const styles = makeStyles(resolvedTheme);

  const visibleRecurring = recurringTasks.filter((rt) => !(rt.end_date && rt.end_date < isoToday));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerTitles}>
              <Text style={[styles.title, { color: c.text }]}>Tasks</Text>
              <Text style={[styles.subtitle, { color: c.textMuted }]}>
                {isToday ? "Today" : selectedDayLabel} — {doneCount}/{tasks.length} done
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.recurringChip,
                { borderColor: cardBorder, backgroundColor: c.surface },
              ]}
              onPress={() => setRecurringModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Manage recurring tasks"
            >
              <Ionicons name="repeat" size={15} color={c.primary} />
              <Text style={[styles.recurringChipText, { color: c.primary }]}>Recurring</Text>
            </TouchableOpacity>
          </View>

          {/* Week navigation */}
          <View
            style={[
              styles.weekNavCard,
              {
                backgroundColor: c.surface,
                borderColor: cardBorder,
              },
            ]}
          >
            <TouchableOpacity
              style={[styles.weekArrowBtn, { backgroundColor: c.surfaceAlt }]}
              onPress={() => setWeekOffset((o) => o - 1)}
              accessibilityLabel="Previous week"
            >
              <Ionicons name="chevron-back" size={20} color={c.primary} />
            </TouchableOpacity>
            <View style={styles.weekNavCenter}>
              <Text style={[styles.weekRange, { color: c.text }]}>{weekRangeLabel(weekOffset, wsd)}</Text>
              {weekOffset !== 0 ? (
                <TouchableOpacity onPress={() => setWeekOffset(0)} hitSlop={8}>
                  <Text style={[styles.todayLink, { color: c.primary }]}>Jump to today</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              style={[styles.weekArrowBtn, { backgroundColor: c.surfaceAlt }]}
              onPress={() => setWeekOffset((o) => o + 1)}
              accessibilityLabel="Next week"
            >
              <Ionicons name="chevron-forward" size={20} color={c.primary} />
            </TouchableOpacity>
          </View>

          {/* Day picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayPicker}>
            {allWeekDays.map((d) => {
              const selected = selectedDate === d.date;
              const today = d.date === isoToday;
              return (
                <TouchableOpacity
                  key={d.date}
                  style={[
                    styles.dayChip,
                    {
                      borderColor: selected ? c.primary : today ? c.primary + "55" : cardBorder,
                      backgroundColor: selected ? c.primary : c.surface,
                      borderWidth: 1,
                    },
                  ]}
                  onPress={() => {
                    setSelectedDate(d.date);
                    setRolloverTaskId(null);
                    setEditingId(null);
                  }}
                >
                  <Text
                    style={[
                      styles.dayChipLabel,
                      { color: selected ? pillLabelOnPrimary : c.text },
                      today && !selected && { fontWeight: "700", color: c.text },
                    ]}
                  >
                    {d.label}
                  </Text>
                  {today ? (
                    <Text
                      style={[
                        styles.dayChipDot,
                        { color: selected ? pillLabelOnPrimary + "99" : c.primary },
                      ]}
                    >
                      •
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {weekLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : tasks.length > 0 ? (
            <View style={styles.taskList}>
              {tasks.map((task) => {
                const stat = task.recurring_task_id ? recurringStats[task.recurring_task_id] : null;
                const expanded = expandedTaskId === task.id;
                const subDone = task.subtasks.filter((s) => s.done).length;
                const subTotal = task.subtasks.length;

                return (
                  <View
                    key={task.id}
                    style={[
                      styles.taskCard,
                      {
                        backgroundColor: c.surface,
                        borderColor: cardBorder,
                      },
                    ]}
                  >
                    <View style={styles.taskRow}>
                      <Pressable
                        style={styles.checkboxHit}
                        onPress={() => void handleToggle(task.id, !task.done)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: task.done }}
                      >
                        {task.done ? (
                          <View style={[styles.checkboxFilled, { backgroundColor: c.primary }]}>
                            <Ionicons name="checkmark" size={14} color={onPrimary} />
                          </View>
                        ) : (
                          <View style={[styles.checkboxRing, { borderColor: c.textMuted }]} />
                        )}
                      </Pressable>

                      {editingId === task.id ? (
                        <TextInput
                          style={[
                            styles.taskEditInput,
                            { color: c.text, borderColor: cardBorder, backgroundColor: c.surfaceAlt },
                          ]}
                          value={editText}
                          onChangeText={setEditText}
                          autoFocus
                          onBlur={() => void finishEdit(task)}
                          onSubmitEditing={() => void finishEdit(task)}
                          returnKeyType="done"
                          placeholderTextColor={c.textMuted}
                        />
                      ) : (
                        <Pressable
                          style={styles.taskTextWrap}
                          onPress={() => {
                            if (!task.done && !isPastWeek) {
                              setEditingId(task.id);
                              setEditText(task.text);
                            }
                          }}
                          disabled={task.done || isPastWeek}
                        >
                          {task.recurring_task_id != null ? (
                            <View
                              style={[
                                styles.recBadgePill,
                                {
                                  backgroundColor: resolvedTheme === "dark" ? "rgba(251,191,36,0.18)" : "rgba(217,119,6,0.15)",
                                  borderColor: resolvedTheme === "dark" ? "rgba(251,191,36,0.45)" : "rgba(217,119,6,0.35)",
                                },
                              ]}
                            >
                              <Ionicons name="repeat" size={11} color={c.warning} />
                              <Text style={[styles.recBadgePillText, { color: c.warning }]}>Recurring</Text>
                            </View>
                          ) : null}
                          <Text
                            style={[
                              styles.taskText,
                              { color: task.done ? c.textMuted : c.text },
                              task.done && styles.taskTextDone,
                            ]}
                            numberOfLines={4}
                          >
                            {task.text}
                          </Text>
                          {subTotal > 0 ? (
                            <Text style={[styles.subtaskCount, { color: c.textSecondary }]}>
                              {" "}
                              ({subDone}/{subTotal})
                            </Text>
                          ) : null}
                          {stat ? (
                            <View
                              style={[
                                styles.weekStat,
                                {
                                  backgroundColor: resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : c.surfaceAlt,
                                  borderColor: hairlineBorder,
                                },
                              ]}
                            >
                              <Text style={[styles.weekStatText, { color: c.textSecondary }]}>
                                {stat.done}/{stat.total}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                      )}

                      {!isPastWeek && editingId !== task.id ? (
                        <View style={styles.taskActions}>
                          <TouchableOpacity
                            style={styles.smallBtn}
                            onPress={() => {
                              setExpandedTaskId(expanded ? null : task.id);
                              setSubtaskDraft("");
                            }}
                            accessibilityLabel={expanded ? "Collapse subtasks" : "Expand subtasks"}
                          >
                            <Ionicons
                              name={expanded ? "chevron-up" : "list-outline"}
                              size={20}
                              color={expanded ? c.primary : c.textMuted}
                            />
                          </TouchableOpacity>
                          {!task.done && !task.recurring_task_id ? (
                            <View style={styles.rolloverAnchor}>
                              <TouchableOpacity
                                style={styles.smallBtn}
                                onPress={() =>
                                  setRolloverTaskId((id) => (id === task.id ? null : task.id))
                                }
                                accessibilityLabel="Move to another day"
                              >
                                <Ionicons name="arrow-redo-outline" size={20} color={c.textMuted} />
                              </TouchableOpacity>
                              {rolloverTaskId === task.id ? (
                                <View
                                  style={[
                                    styles.rolloverMenu,
                                    { backgroundColor: c.surfaceAlt, borderColor: cardBorder },
                                  ]}
                                >
                                  {rolloverTargets.map((rd) => (
                                    <TouchableOpacity
                                      key={rd.date}
                                      style={styles.rolloverOption}
                                      onPress={() => void handleRollover(task.id, rd.date)}
                                    >
                                      <Text style={[styles.rolloverOptionText, { color: c.text }]}>
                                        {rd.label}
                                        {rd.date === isoToday ? " (today)" : ""}
                                      </Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                          <TouchableOpacity
                            style={styles.smallBtn}
                            onPress={() => void handleDelete(task.id)}
                            accessibilityLabel="Delete task"
                          >
                            <Ionicons name="trash-outline" size={20} color={c.error} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>

                    {expanded && !isPastWeek ? (
                      <View style={[styles.subtaskSection, { borderTopColor: hairlineBorder }]}>
                        <View style={[styles.subtaskNested, { borderLeftColor: c.primary + "44" }]}>
                          {task.subtasks.map((st) => (
                            <View key={st.id} style={styles.subtaskRow}>
                              <Pressable
                                style={styles.subtaskCheckboxHit}
                                onPress={() => void handleToggleSubtask(st.id, !st.done)}
                              >
                                {st.done ? (
                                  <View style={[styles.checkboxFilledSm, { backgroundColor: c.primary }]}>
                                    <Ionicons name="checkmark" size={11} color={onPrimary} />
                                  </View>
                                ) : (
                                  <View style={[styles.checkboxRingSm, { borderColor: c.textMuted }]} />
                                )}
                              </Pressable>
                              <Text
                                style={[
                                  styles.subtaskText,
                                  { color: st.done ? c.textMuted : c.textSecondary },
                                  st.done && styles.taskTextDone,
                                ]}
                                numberOfLines={6}
                              >
                                {st.text}
                              </Text>
                              <TouchableOpacity onPress={() => void handleDeleteSubtask(st.id)}>
                                <Ionicons name="close-circle-outline" size={18} color={c.textMuted} />
                              </TouchableOpacity>
                            </View>
                          ))}
                          <View style={styles.subtaskAddRow}>
                            <TextInput
                              style={[
                                styles.subtaskInput,
                                {
                                  color: c.text,
                                  borderColor: cardBorder,
                                  backgroundColor: resolvedTheme === "dark" ? "rgba(255,255,255,0.04)" : c.surfaceAlt,
                                },
                              ]}
                              placeholder="New subtask…"
                              placeholderTextColor={c.textMuted}
                              value={subtaskDraft}
                              onChangeText={setSubtaskDraft}
                              onSubmitEditing={() => void handleAddSubtask(task.id)}
                              returnKeyType="done"
                            />
                            <TouchableOpacity
                              style={[styles.subtaskAddBtn, { backgroundColor: c.primary }]}
                              onPress={() => void handleAddSubtask(task.id)}
                              disabled={!subtaskDraft.trim()}
                            >
                              <Ionicons name="add" size={22} color={onPrimary} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    ) : null}

                    {expanded && isPastWeek && task.subtasks.length > 0 ? (
                      <View style={[styles.subtaskSection, { borderTopColor: hairlineBorder }]}>
                        <View style={[styles.subtaskNested, { borderLeftColor: c.primary + "44" }]}>
                          {task.subtasks.map((st) => (
                            <View key={st.id} style={styles.subtaskRow}>
                              {st.done ? (
                                <View style={[styles.checkboxFilledSm, { backgroundColor: c.primary }]}>
                                  <Ionicons name="checkmark" size={11} color={onPrimary} />
                                </View>
                              ) : (
                                <View style={[styles.checkboxRingSm, { borderColor: c.textMuted }]} />
                              )}
                              <Text
                                style={[
                                  styles.subtaskText,
                                  { color: st.done ? c.textMuted : c.textSecondary },
                                  st.done && styles.taskTextDone,
                                ]}
                                numberOfLines={6}
                              >
                                {st.text}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.empty, { color: c.textMuted }]}>
              No tasks for {isToday ? "today" : selectedDayLabel} yet.
            </Text>
          )}
        </ScrollView>

        {!isPastWeek ? (
          <View style={[styles.footer, { borderTopColor: hairlineBorder, backgroundColor: c.bg }]}>
            <View
              style={[
                styles.footerComposer,
                {
                  backgroundColor: c.surface,
                  borderColor: cardBorder,
                },
              ]}
            >
              <TextInput
                style={[styles.footerInput, { color: c.text }]}
                placeholder={`Add a task for ${isToday ? "today" : selectedDayLabel}…`}
                placeholderTextColor={c.textMuted}
                value={newTaskText}
                onChangeText={setNewTaskText}
                onSubmitEditing={() => void handleAdd()}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[
                  styles.footerAddBtn,
                  {
                    backgroundColor: newTaskText.trim() ? c.primary : c.surfaceAlt,
                    opacity: newTaskText.trim() ? 1 : 0.85,
                  },
                ]}
                onPress={() => void handleAdd()}
                disabled={!newTaskText.trim()}
              >
                <Ionicons name="arrow-up" size={22} color={newTaskText.trim() ? onPrimary : c.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Recurring tasks modal */}
      <Modal
        visible={recurringModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setRecurringModalOpen(false);
          setEditRecId(null);
          setDeleteConfirmId(null);
          setRecError(null);
        }}
      >
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>Recurring tasks</Text>
            <TouchableOpacity
              onPress={() => {
                setRecurringModalOpen(false);
                setEditRecId(null);
                setDeleteConfirmId(null);
                setRecError(null);
              }}
              hitSlop={12}
            >
              <Ionicons name="close" size={26} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {recError ? (
              <TouchableOpacity
                style={[styles.errorBanner, { backgroundColor: c.error + "22" }]}
                onPress={() => setRecError(null)}
              >
                <Text style={[styles.errorBannerText, { color: c.error }]}>{recError}</Text>
              </TouchableOpacity>
            ) : null}

            {recurringLoading ? (
              <ActivityIndicator color={c.primary} style={{ marginVertical: 16 }} />
            ) : visibleRecurring.length > 0 ? (
              <View style={styles.recurringList}>
                {visibleRecurring.map((rt) => (
                  <View
                    key={rt.id}
                    style={[
                      styles.recurringCard,
                      { backgroundColor: c.surface, borderColor: c.border },
                      !rt.active && { opacity: 0.65 },
                    ]}
                  >
                    {editRecId === rt.id ? (
                      <RecurringEditBlock
                        rt={rt}
                        c={c}
                        setRecError={setRecError}
                        onSave={async (updated) => {
                          setRecError(null);
                          try {
                            await TaskService.updateRecurringTask(
                              rt.id,
                              updated.text,
                              updated.recurrence_type,
                              updated.recurrence_days,
                              updated.interval_days,
                              updated.end_date,
                              updated.active
                            );
                            setEditRecId(null);
                            await loadRecurring();
                            await loadWeek();
                          } catch (e) {
                            setRecError(extractError(e, "Failed to save"));
                          }
                        }}
                        onCancel={() => setEditRecId(null)}
                      />
                    ) : (
                      <>
                        <View style={styles.recurringCardBody}>
                          <Text style={[styles.recurringText, { color: c.text }]}>{rt.text}</Text>
                          <Text style={[styles.recurringMeta, { color: c.textMuted }]}>
                            {recurrenceDescription(rt)}
                            {!rt.active ? " · paused" : ""}
                          </Text>
                          <Text style={[styles.recurringDates, { color: c.textMuted }]}>
                            Starts {rt.start_date}
                            {rt.end_date ? ` · ends ${rt.end_date}` : ""}
                          </Text>
                        </View>
                        <View style={styles.recurringActions}>
                          <TouchableOpacity onPress={() => setEditRecId(rt.id)}>
                            <Ionicons name="create-outline" size={22} color={c.accent} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => void handleToggleRecActive(rt)}>
                            <Ionicons name={rt.active ? "pause-outline" : "play-outline"} size={22} color={c.textSecondary} />
                          </TouchableOpacity>
                          {deleteConfirmId === rt.id ? (
                            <View style={styles.deleteConfirmRow}>
                              <TouchableOpacity
                                style={[styles.miniChip, { borderColor: c.border }]}
                                onPress={() => void handleDeleteRecurring(rt.id, true)}
                              >
                                <Text style={[styles.miniChipText, { color: c.error }]}>+delete days</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.miniChip, { borderColor: c.border }]}
                                onPress={() => void handleDeleteRecurring(rt.id, false)}
                              >
                                <Text style={[styles.miniChipText, { color: c.text }]}>keep days</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => setDeleteConfirmId(null)}>
                                <Ionicons name="close" size={20} color={c.textMuted} />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => setDeleteConfirmId(rt.id)}>
                              <Ionicons name="trash-outline" size={22} color={c.error} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.empty, { color: c.textMuted }]}>No active recurring tasks.</Text>
            )}

            <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Add recurring</Text>

            <TextInput
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              placeholder="Task title"
              placeholderTextColor={c.textMuted}
              value={newRecText}
              onChangeText={setNewRecText}
            />

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Recurrence</Text>
            <TouchableOpacity
              style={[styles.selectTrigger, { borderColor: c.border, backgroundColor: c.surface }]}
              onPress={() => setRecurrencePickerOpen(true)}
            >
              <Text style={{ color: c.text }}>{RECURRENCE_LABELS[newRecType]}</Text>
              <Ionicons name="chevron-down" size={18} color={c.textMuted} />
            </TouchableOpacity>

            {newRecType === "specific_days" ? (
              <View style={styles.dowRow}>
                {DOW_LABELS.map((label, i) => (
                  <TouchableOpacity
                    key={label}
                    style={[
                      styles.dowChip,
                      {
                        borderColor: c.border,
                        backgroundColor: newRecDays.includes(i) ? c.primary : c.surface,
                      },
                    ]}
                    onPress={() => toggleDowSelection(i)}
                  >
                    <Text style={{ color: newRecDays.includes(i) ? "#fff" : c.text, fontSize: 11 }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {newRecType === "every_n_days" ? (
              <View style={styles.intervalRow}>
                <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Every</Text>
                <TextInput
                  style={[
                    styles.intervalInput,
                    { color: c.text, borderColor: c.border, backgroundColor: c.surface },
                  ]}
                  keyboardType="number-pad"
                  value={String(newRecInterval)}
                  onChangeText={(t) => setNewRecInterval(Math.max(2, parseInt(t, 10) || 2))}
                />
                <Text style={[styles.fieldLabel, { color: c.textMuted }]}>days</Text>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Start date (YYYY-MM-DD)</Text>
            <TextInput
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              placeholder={isoToday}
              placeholderTextColor={c.textMuted}
              value={newRecStartDate}
              onChangeText={setNewRecStartDate}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>End date (optional)</Text>
            <TextInput
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              placeholder="Blank = never ends"
              placeholderTextColor={c.textMuted}
              value={newRecEndDate}
              onChangeText={setNewRecEndDate}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={[styles.primaryWideBtn, { backgroundColor: newRecText.trim() ? c.primary : c.surfaceAlt }]}
              onPress={() => void handleAddRecurring()}
              disabled={!newRecText.trim()}
            >
              <Text style={[styles.primaryWideBtnText, { color: newRecText.trim() ? "#fff" : c.textMuted }]}>
                Add recurring task
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={recurrencePickerOpen} transparent animationType="fade">
        <Pressable style={styles.pickerOverlay} onPress={() => setRecurrencePickerOpen(false)}>
          <View style={[styles.pickerSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.pickerTitle, { color: c.text }]}>Recurrence type</Text>
            {RECURRENCE_ORDER.map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.pickerRow, newRecType === key && { backgroundColor: c.surfaceAlt }]}
                onPress={() => {
                  setNewRecType(key);
                  setRecurrencePickerOpen(false);
                }}
              >
                <Text style={{ color: c.text }}>{RECURRENCE_LABELS[key]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function RecurringEditBlock({
  rt,
  c,
  setRecError,
  onSave,
  onCancel,
}: {
  rt: RecurringTask;
  c: ReturnType<typeof getColors>;
  setRecError: (msg: string | null) => void;
  onSave: (updated: {
    text: string;
    recurrence_type: RecurrenceType;
    recurrence_days: string | null;
    interval_days: number | null;
    end_date: string | null;
    active: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(rt.text);
  const [recType, setRecType] = useState<RecurrenceType>(rt.recurrence_type);
  const [days, setDays] = useState<number[]>(
    rt.recurrence_days ? rt.recurrence_days.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : []
  );
  const [interval, setInterval] = useState(rt.interval_days ?? 2);
  const [endDate, setEndDate] = useState(rt.end_date ?? "");
  const [active, setActive] = useState(rt.active);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={{ gap: 10 }}>
      <TextInput
        style={[stylesStatic.input, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
        value={text}
        onChangeText={setText}
        placeholderTextColor={c.textMuted}
      />
      <TouchableOpacity
        style={[stylesStatic.selectTrigger, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
        onPress={() => setPickerOpen(true)}
      >
        <Text style={{ color: c.text }}>{RECURRENCE_LABELS[recType]}</Text>
        <Ionicons name="chevron-down" size={18} color={c.textMuted} />
      </TouchableOpacity>

      {recType === "specific_days" ? (
        <View style={stylesStatic.dowRow}>
          {DOW_LABELS.map((label, i) => (
            <TouchableOpacity
              key={label}
              style={[
                stylesStatic.dowChip,
                {
                  borderColor: c.border,
                  backgroundColor: days.includes(i) ? c.primary : c.surface,
                },
              ]}
              onPress={() =>
                setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
              }
            >
              <Text style={{ color: days.includes(i) ? "#fff" : c.text, fontSize: 11 }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {recType === "every_n_days" ? (
        <View style={stylesStatic.intervalRow}>
          <Text style={{ color: c.textMuted }}>Every</Text>
          <TextInput
            style={[stylesStatic.intervalInput, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            keyboardType="number-pad"
            value={String(interval)}
            onChangeText={(t) => setInterval(Math.max(2, parseInt(t, 10) || 2))}
          />
          <Text style={{ color: c.textMuted }}>days</Text>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text style={{ color: c.textMuted, fontSize: 12 }}>End date (YYYY-MM-DD, blank = none)</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            style={[stylesStatic.input, { flex: 1, color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            value={endDate}
            onChangeText={setEndDate}
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
          />
          {endDate ? (
            <TouchableOpacity
              onPress={() => {
                setEndDate("");
                setActive(true);
              }}
            >
              <Text style={{ color: c.accent }}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 8 }} onPress={() => setActive(!active)}>
        <Ionicons name={active ? "checkbox" : "square-outline"} size={22} color={active ? c.primary : c.textMuted} />
        <Text style={{ color: c.text }}>Active</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity
          style={[stylesStatic.primaryWideBtn, { flex: 1, backgroundColor: text.trim() ? c.primary : c.surfaceAlt }]}
          disabled={!text.trim()}
          onPress={() => {
            if (recType === "specific_days" && days.length === 0) {
              setRecError("Pick at least one weekday.");
              return;
            }
            setRecError(null);
            void onSave({
              text,
              recurrence_type: recType,
              recurrence_days: recType === "specific_days" ? [...days].sort((a, b) => a - b).join(",") : null,
              interval_days: recType === "every_n_days" ? interval : null,
              end_date: endDate.trim() || null,
              active,
            });
          }}
        >
          <Text style={{ color: text.trim() ? "#fff" : c.textMuted, fontWeight: "700", textAlign: "center" }}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[stylesStatic.primaryWideBtn, { flex: 1, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border }]}
          onPress={onCancel}
        >
          <Text style={{ color: c.text, fontWeight: "600", textAlign: "center" }}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade">
        <Pressable style={stylesStatic.pickerOverlay} onPress={() => setPickerOpen(false)}>
          <View style={[stylesStatic.pickerSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[stylesStatic.pickerTitle, { color: c.text }]}>Recurrence type</Text>
            {RECURRENCE_ORDER.map((key) => (
              <TouchableOpacity
                key={key}
                style={[stylesStatic.pickerRow, recType === key && { backgroundColor: c.surfaceAlt }]}
                onPress={() => {
                  setRecType(key);
                  setPickerOpen(false);
                }}
              >
                <Text style={{ color: c.text }}>{RECURRENCE_LABELS[key]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const stylesStatic = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  dowChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  intervalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  intervalInput: {
    borderWidth: 1,
    borderRadius: 8,
    width: 56,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: "center",
    fontSize: 15,
  },
  primaryWideBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    padding: 16,
  },
  pickerSheet: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 8,
    maxHeight: "70%",
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pickerRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
});

function makeStyles(theme: "dark" | "light") {
  const cardElev = Platform.OS === "android" ? 4 : 2;
  const shadowOpacity = theme === "dark" ? 0.35 : 0.12;
  return StyleSheet.create({
    screen: { flex: 1 },
    flex: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 12,
      marginTop: 4,
    },
    headerTitles: { flex: 1, paddingRight: 8 },
    title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.3 },
    subtitle: { fontSize: 14, marginTop: 4, lineHeight: 19 },
    recurringChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
    },
    recurringChipText: { fontSize: 12, fontWeight: "700" },
    weekNavCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 16,
      borderWidth: 1,
      marginBottom: 14,
      elevation: cardElev,
      shadowColor: "#000",
      shadowOpacity,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    weekArrowBtn: {
      width: 40,
      height: 40,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
    },
    weekNavCenter: { alignItems: "center", flex: 1, paddingHorizontal: 8 },
    weekRange: { fontSize: 15, fontWeight: "700", textAlign: "center", letterSpacing: -0.2 },
    todayLink: { fontSize: 12, fontWeight: "600", marginTop: 4 },
    dayPicker: {
      flexDirection: "row",
      gap: 8,
      paddingBottom: 16,
      paddingRight: 8,
    },
    dayChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      alignItems: "center",
      minWidth: 56,
    },
    dayChipLabel: { fontSize: 13, fontWeight: "600" },
    dayChipDot: { fontSize: 10, lineHeight: 12, marginTop: 1 },
    loadingRow: { paddingVertical: 24, alignItems: "center" },
    taskList: { gap: 12 },
    taskCard: {
      borderRadius: 16,
      borderWidth: 1,
      overflow: "hidden",
      elevation: cardElev,
      shadowColor: "#000",
      shadowOpacity,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    taskRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 10,
    },
    checkboxHit: { paddingTop: 4, paddingRight: 2 },
    checkboxRing: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
    },
    checkboxFilled: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxRingSm: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
    },
    checkboxFilledSm: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    subtaskCheckboxHit: { paddingTop: 2 },
    taskTextWrap: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
    taskEditInput: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      minHeight: 40,
    },
    taskText: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
    taskTextDone: { textDecorationLine: "line-through", opacity: 0.85 },
    recBadgePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
    },
    recBadgePillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
    subtaskCount: { fontSize: 13 },
    weekStat: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
    },
    weekStatText: { fontSize: 11, fontWeight: "600" },
    taskActions: { flexDirection: "row", alignItems: "flex-start", gap: 2 },
    smallBtn: { padding: 4 },
    rolloverAnchor: { position: "relative" },
    rolloverMenu: {
      position: "absolute",
      right: 0,
      top: 36,
      zIndex: 20,
      borderRadius: 10,
      borderWidth: 1,
      minWidth: 140,
      elevation: 6,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
    },
    rolloverOption: {
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    rolloverOptionText: { fontSize: 14 },
    subtaskSection: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingBottom: 12,
      paddingTop: 10,
    },
    subtaskNested: {
      marginTop: 4,
      paddingLeft: 12,
      marginLeft: 6,
      borderLeftWidth: 3,
      gap: 10,
    },
    subtaskRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    subtaskText: { flex: 1, fontSize: 13, lineHeight: 18 },
    subtaskAddRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
    subtaskInput: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
    },
    subtaskAddBtn: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
    },
    empty: { fontSize: 14, marginTop: 8, lineHeight: 20 },
    footer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      paddingBottom: Platform.OS === "android" ? 14 : 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    footerComposer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 999,
      borderWidth: 1,
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 6,
      elevation: Platform.OS === "android" ? 6 : 0,
      shadowColor: "#000",
      shadowOpacity: theme === "dark" ? 0.25 : 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    footerInput: {
      flex: 1,
      borderWidth: 0,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 14,
      minHeight: 40,
    },
    footerAddBtn: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
    },
    modalSafe: { flex: 1 },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modalTitle: { fontSize: 20, fontWeight: "800" },
    modalScroll: { padding: 16, paddingBottom: 40 },
    errorBanner: {
      padding: 12,
      borderRadius: 10,
      marginBottom: 12,
    },
    errorBannerText: { fontSize: 14 },
    recurringList: { gap: 10, marginBottom: 20 },
    recurringCard: {
      borderRadius: 14,
      borderWidth: 1,
      padding: 12,
      gap: 8,
    },
    recurringCardBody: { flex: 1 },
    recurringText: { fontSize: 16, fontWeight: "700" },
    recurringMeta: { fontSize: 13, marginTop: 4 },
    recurringDates: { fontSize: 12, marginTop: 4 },
    recurringActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      flexWrap: "wrap",
      marginTop: 4,
    },
    deleteConfirmRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    miniChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    miniChipText: { fontSize: 11, fontWeight: "600" },
    sectionLabel: { fontSize: 13, fontWeight: "700", marginBottom: 10, marginTop: 8 },
    input: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      marginBottom: 12,
    },
    fieldLabel: { fontSize: 12, marginBottom: 6 },
    selectTrigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: 12,
    },
    dowRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    dowChip: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
    },
    intervalRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    },
    intervalInput: {
      borderWidth: 1,
      borderRadius: 10,
      width: 64,
      paddingVertical: 10,
      textAlign: "center",
      fontSize: 16,
    },
    primaryWideBtn: {
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: "center",
      marginTop: 8,
    },
    primaryWideBtnText: { fontSize: 16, fontWeight: "700" },
    pickerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
      padding: 16,
    },
    pickerSheet: {
      borderRadius: 16,
      borderWidth: 1,
      paddingVertical: 8,
      maxHeight: "75%",
    },
    pickerTitle: {
      fontSize: 16,
      fontWeight: "700",
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    pickerRow: {
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
  });
}
