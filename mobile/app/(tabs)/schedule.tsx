import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useScheduleStore } from "../../src/store/schedule";
import { useSettingsStore } from "../../src/store/settings";
import { getColors } from "../../src/lib/theme";
import {
  blockDurationMs,
  dayNameShort,
  formatHoursMinutes,
  formatMinuteAsTime,
} from "../../src/lib/time";
import { useTimerStore } from "../../src/store/timer";
import type { DayTarget, ScheduleBlock } from "../../src/types";

/** Monday-first weekday order (JS: 0=Sun … 6=Sat). */
const DAYS_MON_SUN = [1, 2, 3, 4, 5, 6, 0] as const;

function blocksForDay(all: ScheduleBlock[], dayOfWeek: number): ScheduleBlock[] {
  return all.filter((b) => b.day_of_week === dayOfWeek).sort((a, b) => a.start_min - b.start_min);
}

function targetMinutesForDay(dayTargets: DayTarget[], dayOfWeek: number): number {
  return dayTargets.find((d) => d.day_of_week === dayOfWeek)?.target_min ?? 0;
}

const PRESET_COLORS = ["#34D399", "#38bdf8", "#a78bfa", "#f472b6", "#fbbf24", "#94a3b8", "#f87171"];

function minutesToHHMM(totalMin: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(totalMin)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function parseHHMM(value: string): number | null {
  const s = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 24 || m < 0 || m > 59) return null;
  if (h === 24 && m !== 0) return null;
  const out = h * 60 + m;
  if (out > 1440) return null;
  return out;
}

export default function ScheduleScreen() {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const timeFormat = useSettingsStore((s) => s.appSettings.time_format);
  const c = getColors(resolvedTheme);
  const cardBorder = resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : c.border;
  const hairlineBorder = resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : c.border;
  const onPrimary = resolvedTheme === "dark" ? "#0f1422" : "#ffffff";

  const templates = useScheduleStore((s) => s.templates);
  const activeTemplateId = useScheduleStore((s) => s.activeTemplateId);
  const blocks = useScheduleStore((s) => s.blocks);
  const dayTargets = useScheduleStore((s) => s.dayTargets);
  const saving = useScheduleStore((s) => s.saving);
  const storeError = useScheduleStore((s) => s.error);
  const draftTemplateName = useScheduleStore((s) => s.draftTemplateName);
  const checklistItems = useScheduleStore((s) => s.checklistItems);

  const load = useScheduleStore((s) => s.load);
  const clearError = useScheduleStore((s) => s.clearError);
  const setDraftTemplateName = useScheduleStore((s) => s.setDraftTemplateName);
  const createTemplate = useScheduleStore((s) => s.createTemplate);
  const activateTemplate = useScheduleStore((s) => s.activateTemplate);
  const addBlock = useScheduleStore((s) => s.addBlock);
  const updateBlock = useScheduleStore((s) => s.updateBlock);
  const deleteBlock = useScheduleStore((s) => s.deleteBlock);
  const getDayTarget = useScheduleStore((s) => s.getDayTarget);
  const setDayTarget = useScheduleStore((s) => s.setDayTarget);
  const save = useScheduleStore((s) => s.save);
  const saveDayTargets = useScheduleStore((s) => s.saveDayTargets);
  const addChecklistItem = useScheduleStore((s) => s.addChecklistItem);
  const removeChecklistItem = useScheduleStore((s) => s.removeChecklistItem);

  const refreshStatus = useTimerStore((s) => s.refreshStatus);

  const [selectedDow, setSelectedDow] = useState(() => new Date().getDay());
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [editBlock, setEditBlock] = useState<ScheduleBlock | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<Record<number, boolean>>({});
  const [checklistDraftByBlock, setChecklistDraftByBlock] = useState<Record<number, string>>({});
  const [draftLabel, setDraftLabel] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftColor, setDraftColor] = useState("");
  const [targetHoursText, setTargetHoursText] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  const activeTemplateName = useMemo(() => {
    const t = templates.find((x) => x.id === activeTemplateId);
    return t?.name ?? "No template";
  }, [templates, activeTemplateId]);

  const dayBlocks = blocksForDay(blocks, selectedDow);
  const targetMin = getDayTarget(selectedDow);
  const targetHoursDisplay = targetMin > 0 ? String(targetMin / 60) : "";

  useEffect(() => {
    setTargetHoursText(targetHoursDisplay);
  }, [selectedDow, targetHoursDisplay]);

  const totalWeeklyMs = useMemo(() => {
    return (DAYS_MON_SUN as readonly number[]).reduce((sum, day) => {
      const bs = blocksForDay(blocks, day);
      const target = targetMinutesForDay(dayTargets, day);
      if (target > 0) return sum + target * 60_000;
      return sum + bs.reduce((s, b) => s + blockDurationMs(b.start_min, b.end_min), 0);
    }, 0);
  }, [blocks, dayTargets]);

  const workDaysCount = useMemo(() => {
    return DAYS_MON_SUN.filter((day) => blocksForDay(blocks, day).length > 0).length;
  }, [blocks]);

  function openEdit(block: ScheduleBlock) {
    setEditBlock(block);
    setDraftLabel(block.label);
    setDraftStart(minutesToHHMM(block.start_min));
    setDraftEnd(minutesToHHMM(block.end_min));
    setDraftColor(block.color || PRESET_COLORS[0]);
  }

  function closeEdit() {
    setEditBlock(null);
  }

  function applyEdit() {
    if (!editBlock) return;
    const start = parseHHMM(draftStart);
    const end = parseHHMM(draftEnd);
    if (start === null || end === null) {
      Alert.alert("Invalid time", "Use HH:MM in 24-hour form (e.g. 09:00, 17:30). End may be 24:00.");
      return;
    }
    const label = draftLabel.trim() || "Work block";
    let color = draftColor.trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      color = PRESET_COLORS[0];
    }
    updateBlock(editBlock.id, {
      label,
      color,
      start_min: start,
      end_min: end,
    });
    closeEdit();
  }

  function confirmDeleteBlock(block: ScheduleBlock) {
    Alert.alert("Delete block", `Remove “${block.label}”?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteBlock(block.id) },
    ]);
  }

  function toggleExpanded(blockId: number) {
    setExpandedBlocks((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
  }

  async function handleSave() {
    await saveDayTargets();
    await save();
    await refreshStatus();
  }

  function onTargetHoursChange(raw: string) {
    setTargetHoursText(raw);
    if (raw === "" || raw === ".") {
      setDayTarget(selectedDow, 0);
      return;
    }
    const h = parseFloat(raw);
    if (Number.isNaN(h) || h < 0) return;
    setDayTarget(selectedDow, Math.round(h * 60));
  }

  const styles = makeStyles(c, resolvedTheme);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Schedule</Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          Set working hours per day. Changes apply to the active template.
        </Text>

        <View style={[styles.summaryRow, { borderColor: c.border }]}>
          <Text style={[styles.summaryStrong, { color: c.text }]}>{formatHoursMinutes(totalWeeklyMs)}</Text>
          <Text style={[styles.summaryMuted, { color: c.textSecondary }]}>
            / week · {workDaysCount} day{workDaysCount !== 1 ? "s" : ""}
          </Text>
        </View>

        {storeError ? (
          <TouchableOpacity onPress={clearError} style={[styles.errorBanner, { backgroundColor: c.error + "22" }]}>
            <Text style={[styles.errorText, { color: c.error }]}>{storeError}</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Template</Text>
        <TouchableOpacity
          style={[styles.templateDropdown, { backgroundColor: c.surface, borderColor: cardBorder }]}
          onPress={() => setTemplateModalVisible(true)}
          activeOpacity={0.85}
        >
          <View style={[styles.templateIconWrap, { backgroundColor: c.primary + "22" }]}>
            <Ionicons name="layers-outline" size={22} color={c.primary} />
          </View>
          <View style={styles.templateDropdownText}>
            <Text style={[styles.templateDropdownHint, { color: c.textMuted }]}>Active template</Text>
            <Text style={[styles.templateDropdownName, { color: c.text }]} numberOfLines={1}>
              {activeTemplateName}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={22} color={c.textMuted} />
        </TouchableOpacity>

        <View style={styles.newTemplateRow}>
          <TextInput
            style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
            placeholder="New template name"
            placeholderTextColor={c.textMuted}
            value={draftTemplateName}
            onChangeText={setDraftTemplateName}
          />
          <TouchableOpacity
            style={[styles.secondaryBtn, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
            onPress={() => void createTemplate()}
          >
            <Text style={[styles.secondaryBtnText, { color: c.primary }]}>Create</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Day</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayTabs}>
          {DAYS_MON_SUN.map((dow) => {
            const isSelected = dow === selectedDow;
            const count = blocksForDay(blocks, dow).length;
            const isToday = dow === new Date().getDay();
            return (
              <TouchableOpacity
                key={dow}
                style={[
                  styles.dayTab,
                  {
                    backgroundColor: isSelected ? c.primary : c.surface,
                    borderColor: isSelected ? c.primary : cardBorder,
                  },
                ]}
                onPress={() => setSelectedDow(dow)}
              >
                <Text
                  style={[styles.dayTabLabel, { color: isSelected ? onPrimary : c.text }]}
                  numberOfLines={1}
                >
                  {dayNameShort(dow)}
                </Text>
                {count > 0 ? (
                  <Text
                    style={[
                      styles.dayTabBadge,
                      { color: isSelected ? onPrimary + "cc" : c.textMuted },
                    ]}
                  >
                    {count}
                  </Text>
                ) : null}
                {isToday ? (
                  <View
                    style={[
                      styles.todayDot,
                      { backgroundColor: isSelected ? onPrimary : c.primary },
                    ]}
                  />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
          Blocks · {dayNameShort(selectedDow)}
        </Text>

        {dayBlocks.length === 0 ? (
          <Text style={[styles.emptyHint, { color: c.textMuted }]}>No blocks yet. Add one to schedule this day.</Text>
        ) : (
          dayBlocks.map((block) => {
            const expanded = !!expandedBlocks[block.id];
            const items = checklistItems
              .filter((i) => i.block_id === block.id)
              .sort((a, b) => a.position - b.position);
            const duration = blockDurationMs(block.start_min, block.end_min);
            const accent = block.color || c.primary;
            return (
              <View key={block.id} style={[styles.blockCard, { backgroundColor: c.surface, borderColor: cardBorder }]}>
                <View style={[styles.blockAccentBar, { backgroundColor: accent }]} />
                <View style={styles.blockCardBody}>
                  <View style={styles.blockMain}>
                    <TouchableOpacity style={styles.blockTap} onPress={() => openEdit(block)} activeOpacity={0.7}>
                      <View style={styles.blockInfo}>
                        <Text style={[styles.blockTitle, { color: c.text }]} numberOfLines={1}>
                          {block.label || "Untitled"}
                        </Text>
                        <View style={styles.blockTimeRow}>
                          <Text style={[styles.blockTimeMain, { color: c.text }]}>
                            {formatMinuteAsTime(block.start_min, timeFormat)}
                            <Text style={[styles.blockTimeSep, { color: c.textMuted }]}>{" — "}</Text>
                            {formatMinuteAsTime(block.end_min, timeFormat)}
                          </Text>
                          <Text style={[styles.blockDuration, { color: c.textSecondary }]}>
                            {formatHoursMinutes(duration)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleExpanded(block.id)} hitSlop={8} style={styles.iconHit}>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={c.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmDeleteBlock(block)} hitSlop={8} style={styles.iconHit}>
                      <Ionicons name="trash-outline" size={20} color={c.error} />
                    </TouchableOpacity>
                  </View>

                  {expanded ? (
                    <View style={[styles.checklistSection, { borderTopColor: hairlineBorder }]}>
                      <Text style={[styles.checklistHeading, { color: c.textMuted }]}>Checklist</Text>
                      <View style={[styles.checklistNest, { borderLeftColor: accent + "66" }]}>
                        {items.map((item) => (
                          <View key={item.id} style={styles.checklistRow}>
                            <View style={[styles.checklistBullet, { backgroundColor: accent + "55" }]} />
                            <Text style={[styles.checklistText, { color: c.textSecondary }]}>{item.text}</Text>
                            <TouchableOpacity onPress={() => removeChecklistItem(item.id)} hitSlop={8}>
                              <Ionicons name="close-circle-outline" size={20} color={c.textMuted} />
                            </TouchableOpacity>
                          </View>
                        ))}
                        <View style={styles.addChecklistRow}>
                          <TextInput
                            style={[
                              styles.checklistInput,
                              {
                                backgroundColor:
                                  resolvedTheme === "dark" ? "rgba(255,255,255,0.04)" : c.surfaceAlt,
                                borderColor: cardBorder,
                                color: c.text,
                              },
                            ]}
                            placeholder="New item"
                            placeholderTextColor={c.textMuted}
                            value={checklistDraftByBlock[block.id] ?? ""}
                            onChangeText={(t) => setChecklistDraftByBlock((prev) => ({ ...prev, [block.id]: t }))}
                          />
                          <TouchableOpacity
                            style={[styles.miniBtn, { backgroundColor: c.primary }]}
                            onPress={() => {
                              addChecklistItem(block.id, checklistDraftByBlock[block.id] ?? "");
                              setChecklistDraftByBlock((prev) => {
                                const next = { ...prev };
                                delete next[block.id];
                                return next;
                              });
                            }}
                          >
                            <Text style={[styles.miniBtnText, { color: onPrimary }]}>Add</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })
        )}

        <TouchableOpacity
          style={[styles.addBlockBtn, { borderColor: c.primary }]}
          onPress={() => addBlock(selectedDow, 9 * 60, 17 * 60)}
        >
          <Ionicons name="add-circle-outline" size={22} color={c.primary} />
          <Text style={[styles.addBlockText, { color: c.primary }]}>Add block</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Day target ({dayNameShort(selectedDow)})</Text>
        <View style={[styles.targetCard, { backgroundColor: c.surface, borderColor: cardBorder }]}>
          <Text style={[styles.targetCardHint, { color: c.textMuted }]}>
            Override hours for this day (optional). Leave blank to sum blocks.
          </Text>
          <View style={styles.targetRowInner}>
            <TextInput
              style={[
                styles.targetInput,
                {
                  backgroundColor: resolvedTheme === "dark" ? "rgba(255,255,255,0.04)" : c.surfaceAlt,
                  borderColor: hairlineBorder,
                  color: c.text,
                },
              ]}
              keyboardType="decimal-pad"
              placeholder={dayBlocks.length ? "Sum blocks" : "0"}
              placeholderTextColor={c.textMuted}
              value={targetHoursText}
              onChangeText={onTargetHoursChange}
            />
            <Text style={[styles.targetSuffix, { color: c.textSecondary }]}>hours</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.saveBtn,
            {
              backgroundColor: c.primary,
              opacity: saving || !activeTemplateId ? 0.45 : 1,
              borderColor: c.primaryDark,
            },
          ]}
          disabled={saving || !activeTemplateId}
          onPress={() => void handleSave()}
          activeOpacity={0.9}
        >
          <Ionicons name="save-outline" size={22} color={onPrimary} style={{ marginRight: 8 }} />
          <Text style={[styles.saveBtnText, { color: onPrimary }]}>
            {saving ? "Saving…" : "Save schedule"}
          </Text>
        </TouchableOpacity>

        {!activeTemplateId ? (
          <Text style={[styles.footerHint, { color: c.warning }]}>Select or create a template before saving.</Text>
        ) : null}
      </ScrollView>

      <Modal visible={templateModalVisible} transparent animationType="fade" onRequestClose={() => setTemplateModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTemplateModalVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: c.surface, borderColor: cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: c.text }]}>Templates</Text>
            <ScrollView style={styles.modalList}>
              {templates.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.modalRow,
                    { borderBottomColor: c.border },
                    t.id === activeTemplateId && { backgroundColor: c.primary + "18" },
                  ]}
                  onPress={() => {
                    void activateTemplate(t.id);
                    setTemplateModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalRowText, { color: c.text }]}>{t.name}</Text>
                  {t.id === activeTemplateId ? (
                    <Ionicons name="checkmark-circle" size={22} color={c.primary} />
                  ) : null}
                </TouchableOpacity>
              ))}
              {templates.length === 0 ? (
                <Text style={[styles.modalEmpty, { color: c.textMuted }]}>No templates yet. Create one above.</Text>
              ) : null}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setTemplateModalVisible(false)}>
              <Text style={{ color: c.accent, fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!editBlock} transparent animationType="slide" onRequestClose={closeEdit}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetBackdropFlex} onPress={closeEdit} />
          <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>Edit block</Text>

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Label</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
              value={draftLabel}
              onChangeText={setDraftLabel}
              placeholder="Work block"
              placeholderTextColor={c.textMuted}
            />

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Start / end (24h HH:MM)</Text>
            <View style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
                value={draftStart}
                onChangeText={setDraftStart}
                placeholder="09:00"
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
              />
              <Text style={{ color: c.textMuted }}>to</Text>
              <TextInput
                style={[styles.input, styles.timeInput, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
                value={draftEnd}
                onChangeText={setDraftEnd}
                placeholder="17:00"
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
              />
            </View>

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Color</Text>
            <View style={styles.colorPresets}>
              {PRESET_COLORS.map((hex) => (
                <TouchableOpacity
                  key={hex}
                  style={[
                    styles.colorPreset,
                    { backgroundColor: hex },
                    draftColor.toLowerCase() === hex.toLowerCase() && styles.colorPresetSelected,
                  ]}
                  onPress={() => setDraftColor(hex)}
                />
              ))}
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
              value={draftColor}
              onChangeText={setDraftColor}
              placeholder="#34D399"
              placeholderTextColor={c.textMuted}
              autoCapitalize="characters"
            />

            <View style={styles.sheetActions}>
              <TouchableOpacity style={[styles.sheetSecondary, { borderColor: c.border }]} onPress={closeEdit}>
                <Text style={{ color: c.textSecondary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sheetPrimary, { backgroundColor: c.primary }]} onPress={applyEdit}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof getColors>, theme: "dark" | "light") {
  const elevCard = Platform.OS === "android" ? 4 : 3;
  const shadowOp = theme === "dark" ? 0.32 : 0.1;
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
    subtitle: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
    summaryRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
      marginBottom: 16,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme === "dark" ? "rgba(255,255,255,0.08)" : c.border,
    },
    summaryStrong: { fontSize: 18, fontWeight: "700" },
    summaryMuted: { fontSize: 14 },
    errorBanner: { padding: 12, borderRadius: 12, marginBottom: 12 },
    errorText: { fontSize: 14, textAlign: "center" },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
      marginTop: 10,
    },
    templateDropdown: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: 16,
      borderWidth: 1,
      marginBottom: 12,
      elevation: elevCard,
      shadowColor: "#000",
      shadowOpacity: shadowOp,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    templateIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    templateDropdownText: { flex: 1, minWidth: 0 },
    templateDropdownHint: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
    templateDropdownName: { fontSize: 16, fontWeight: "700", marginTop: 2 },
    newTemplateRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 12 : 8,
      fontSize: 16,
    },
    secondaryBtn: {
      paddingHorizontal: 16,
      justifyContent: "center",
      borderRadius: 10,
      borderWidth: 1,
    },
    secondaryBtnText: { fontWeight: "700", fontSize: 15 },
    dayTabs: { gap: 8, paddingVertical: 6, marginBottom: 12 },
    dayTab: {
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderRadius: 999,
      borderWidth: 1,
      marginRight: 8,
      alignItems: "center",
      minWidth: 72,
    },
    dayTabLabel: { fontSize: 13, fontWeight: "700" },
    dayTabBadge: { fontSize: 10, fontWeight: "600", marginTop: 3, opacity: 0.95 },
    todayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
    emptyHint: { fontSize: 14, marginBottom: 14, lineHeight: 20 },
    blockCard: {
      flexDirection: "row",
      borderRadius: 16,
      borderWidth: 1,
      marginBottom: 12,
      overflow: "hidden",
      elevation: elevCard,
      shadowColor: "#000",
      shadowOpacity: shadowOp,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    blockAccentBar: { width: 5 },
    blockCardBody: { flex: 1, minWidth: 0 },
    blockMain: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingRight: 12, gap: 4 },
    blockTap: { flex: 1, paddingVertical: 2, paddingLeft: 14 },
    blockInfo: { flex: 1, minWidth: 0 },
    blockTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
    blockTimeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 8,
      marginTop: 6,
    },
    blockTimeMain: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
    blockTimeSep: { fontWeight: "400" },
    blockDuration: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
    iconHit: { padding: 6 },
    checklistSection: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth },
    checklistHeading: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 },
    checklistNest: {
      marginLeft: 4,
      paddingLeft: 12,
      borderLeftWidth: 2,
      gap: 10,
    },
    checklistRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    checklistBullet: { width: 6, height: 6, borderRadius: 3 },
    checklistText: { flex: 1, fontSize: 13, lineHeight: 18, paddingRight: 8 },
    addChecklistRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 },
    checklistInput: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 14,
    },
    miniBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
    },
    miniBtnText: { fontWeight: "700", fontSize: 13 },
    addBlockBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 15,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 10,
    },
    addBlockText: { fontSize: 15, fontWeight: "700" },
    targetCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      marginBottom: 20,
      elevation: theme === "dark" ? 2 : 1,
    },
    targetCardHint: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
    targetRowInner: { flexDirection: "row", alignItems: "center", gap: 12 },
    targetInput: {
      flex: 1,
      maxWidth: 140,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      fontSize: 16,
      fontVariant: ["tabular-nums"],
    },
    targetSuffix: { fontSize: 14, fontWeight: "600" },
    saveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 18,
      borderRadius: 16,
      marginTop: 4,
      elevation: Platform.OS === "android" ? 8 : 4,
      shadowColor: "#000",
      shadowOpacity: theme === "dark" ? 0.35 : 0.15,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      borderWidth: 1,
    },
    saveBtnText: { fontSize: 17, fontWeight: "800", letterSpacing: 0.2 },
    footerHint: { textAlign: "center", marginTop: 12, fontSize: 13 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 24,
    },
    modalCard: { borderRadius: 16, borderWidth: 1, maxHeight: "70%" },
    modalTitle: { fontSize: 18, fontWeight: "700", padding: 16, paddingBottom: 8 },
    modalList: { maxHeight: 360 },
    modalRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modalRowText: { fontSize: 16, flex: 1 },
    modalEmpty: { padding: 16, fontSize: 14 },
    modalClose: { padding: 16, alignItems: "center" },
    sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
    sheetBackdropFlex: { flex: 1 },
    sheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      padding: 20,
      paddingBottom: Platform.OS === "ios" ? 32 : 20,
      gap: 4,
    },
    sheetTitle: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
    fieldLabel: { fontSize: 12, fontWeight: "600", marginTop: 8, marginBottom: 4 },
    timeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    timeInput: { flex: 1, textAlign: "center" },
    colorPresets: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 8 },
    colorPreset: { width: 36, height: 36, borderRadius: 18 },
    colorPresetSelected: { borderWidth: 3, borderColor: c.text },
    sheetActions: { flexDirection: "row", gap: 12, marginTop: 20 },
    sheetSecondary: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
    },
    sheetPrimary: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 12 },
  });
}
