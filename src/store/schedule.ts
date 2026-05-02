import { create } from "zustand";
import { apiActivateTemplate, apiCreateTemplate, apiGetSchedule, apiSaveSchedule } from "../lib/tauri";
import type { BlockChecklistItem, SaveSchedulePayload, ScheduleBlock, ScheduleTemplate } from "../types";

type ScheduleStore = {
  templates: ScheduleTemplate[];
  activeTemplateId: number | null;
  blocks: ScheduleBlock[];
  checklistItems: BlockChecklistItem[];
  saving: boolean;
  error: string | null;
  draftTemplateName: string;
  selectedBlockId: number | null;
  load: () => Promise<void>;
  setSelectedBlock: (blockId: number | null) => void;
  setDraftTemplateName: (name: string) => void;
  createTemplate: () => Promise<void>;
  activateTemplate: (templateId: number) => Promise<void>;
  addBlock: (dayOfWeek: number, startMin: number, endMin: number) => void;
  updateBlock: (blockId: number, changes: Partial<ScheduleBlock>) => void;
  deleteBlock: (blockId: number) => void;
  getDayBlocks: (dayOfWeek: number) => ScheduleBlock[];
  addChecklistItem: (blockId: number, text: string) => void;
  removeChecklistItem: (itemId: number) => void;
  save: () => Promise<void>;
  clearError: () => void;
};

function toMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  templates: [],
  activeTemplateId: null,
  blocks: [],
  checklistItems: [],
  saving: false,
  error: null,
  draftTemplateName: "",
  selectedBlockId: null,
  async load() {
    try {
      set({ error: null });
      const payload = await apiGetSchedule();
      set({
        templates: payload.templates,
        activeTemplateId: payload.active_template_id,
        blocks: payload.blocks,
        checklistItems: payload.checklist_items,
      });
    } catch (error) {
      set({ error: toMessage(error, "Unable to load schedule") });
    }
  },
  setSelectedBlock(blockId) {
    set({ selectedBlockId: blockId });
  },
  setDraftTemplateName(name) {
    set({ draftTemplateName: name });
  },
  async createTemplate() {
    const name = get().draftTemplateName.trim();
    if (!name) return;
    try {
      set({ error: null });
      const templateId = await apiCreateTemplate(name);
      await apiActivateTemplate(templateId);
      set({ draftTemplateName: "" });
      await get().load();
    } catch (error) {
      set({ error: toMessage(error, "Unable to create template") });
    }
  },
  async activateTemplate(templateId) {
    try {
      set({ error: null });
      await apiActivateTemplate(templateId);
      await get().load();
    } catch (error) {
      set({ error: toMessage(error, "Unable to switch template") });
    }
  },
  addBlock(dayOfWeek, startMin, endMin) {
    set((state) => {
      const min = Math.max(0, Math.min(startMin, endMin));
      const max = Math.min(1440, Math.max(startMin, endMin));
      const nextTempId = Math.min(0, ...state.blocks.map((b) => b.id)) - 1;
      return {
        blocks: [
          ...state.blocks,
          {
            id: nextTempId,
            template_id: state.activeTemplateId ?? 0,
            day_of_week: dayOfWeek,
            start_min: min,
            end_min: Math.max(min + 30, max),
            label: "Work block",
            color: "#34D399",
          },
        ],
        selectedBlockId: nextTempId,
      };
    });
  },
  updateBlock(blockId, changes) {
    set((state) => ({
      blocks: state.blocks.map((block) => (block.id === blockId ? { ...block, ...changes } : block)),
    }));
  },
  deleteBlock(blockId) {
    set((state) => ({
      blocks: state.blocks.filter((block) => block.id !== blockId),
      checklistItems: state.checklistItems.filter((item) => item.block_id !== blockId),
      selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
    }));
  },
  getDayBlocks(dayOfWeek) {
    return get()
      .blocks.filter((block) => block.day_of_week === dayOfWeek)
      .sort((a, b) => a.start_min - b.start_min);
  },
  addChecklistItem(blockId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => {
      const nextId = Math.min(0, ...state.checklistItems.map((item) => item.id)) - 1;
      const position =
        state.checklistItems
          .filter((item) => item.block_id === blockId)
          .reduce((acc, item) => Math.max(acc, item.position), -1) + 1;
      return {
        checklistItems: [...state.checklistItems, { id: nextId, block_id: blockId, text: trimmed, position }],
      };
    });
  },
  removeChecklistItem(itemId) {
    set((state) => ({ checklistItems: state.checklistItems.filter((item) => item.id !== itemId) }));
  },
  async save() {
    try {
      set({ saving: true, error: null });
      const activeTemplateId = get().activeTemplateId;
      if (!activeTemplateId) {
        set({ saving: false, error: "No active template selected." });
        return;
      }
      const payload: SaveSchedulePayload = {
        template_id: activeTemplateId,
        blocks: get().blocks
          .map((block) => ({
            ...block,
            start_min: Math.max(0, Math.min(1439, block.start_min)),
            end_min: Math.max(1, Math.min(1440, block.end_min)),
          }))
          .filter((block) => block.end_min !== block.start_min),
        checklist_items: get().checklistItems,
      };
      await apiSaveSchedule(payload);
      await get().load();
    } catch (error) {
      set({ error: toMessage(error, "Unable to save schedule") });
    } finally {
      set({ saving: false });
    }
  },
  clearError() {
    set({ error: null });
  },
}));
