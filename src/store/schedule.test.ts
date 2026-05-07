import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useScheduleStore } from "./schedule";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  useScheduleStore.setState({
    templates: [],
    activeTemplateId: null,
    blocks: [],
    checklistItems: [],
    dayTargets: [],
    saving: false,
    error: null,
    draftTemplateName: "",
    selectedBlockId: null,
  });
  vi.clearAllMocks();
});

describe("schedule store", () => {
  describe("load", () => {
    it("populates state from API response", async () => {
      const payload = {
        templates: [{ id: 1, name: "Normal week", is_active: true }],
        active_template_id: 1,
        blocks: [
          { id: 1, template_id: 1, day_of_week: 1, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
        ],
        checklist_items: [{ id: 1, block_id: 1, text: "Standup", position: 0 }],
        day_targets: [],
      };
      mockInvoke.mockResolvedValueOnce(payload);

      await useScheduleStore.getState().load();

      const state = useScheduleStore.getState();
      expect(state.templates).toEqual(payload.templates);
      expect(state.activeTemplateId).toBe(1);
      expect(state.blocks).toHaveLength(1);
      expect(state.checklistItems).toHaveLength(1);
      expect(state.dayTargets).toEqual([]);
      expect(state.error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockInvoke.mockRejectedValueOnce({ message: "Network error" });

      await useScheduleStore.getState().load();

      expect(useScheduleStore.getState().error).toBe("Network error");
    });
  });

  describe("addBlock", () => {
    it("adds a new block with negative temp ID", () => {
      useScheduleStore.setState({ activeTemplateId: 1, blocks: [] });

      useScheduleStore.getState().addBlock(1, 540, 1020);

      const state = useScheduleStore.getState();
      expect(state.blocks).toHaveLength(1);
      expect(state.blocks[0].id).toBeLessThan(0);
      expect(state.blocks[0].day_of_week).toBe(1);
      expect(state.blocks[0].start_min).toBe(540);
      expect(state.blocks[0].end_min).toBe(1020);
      expect(state.selectedBlockId).toBe(state.blocks[0].id);
    });

    it("assigns decrementing temp IDs", () => {
      useScheduleStore.setState({ activeTemplateId: 1, blocks: [] });

      useScheduleStore.getState().addBlock(1, 540, 1020);
      useScheduleStore.getState().addBlock(2, 540, 1020);

      const state = useScheduleStore.getState();
      expect(state.blocks[0].id).toBe(-1);
      expect(state.blocks[1].id).toBe(-2);
    });

    it("normalizes start > end", () => {
      useScheduleStore.setState({ activeTemplateId: 1, blocks: [] });

      useScheduleStore.getState().addBlock(1, 1020, 540);

      const block = useScheduleStore.getState().blocks[0];
      expect(block.start_min).toBe(540);
      expect(block.end_min).toBeLessThanOrEqual(1440);
      expect(block.end_min).toBeGreaterThan(block.start_min);
    });

    it("enforces minimum 30 min block", () => {
      useScheduleStore.setState({ activeTemplateId: 1, blocks: [] });

      useScheduleStore.getState().addBlock(1, 540, 540);

      const block = useScheduleStore.getState().blocks[0];
      expect(block.end_min - block.start_min).toBeGreaterThanOrEqual(30);
    });
  });

  describe("updateBlock", () => {
    it("updates specific fields on a block", () => {
      useScheduleStore.setState({
        blocks: [{ id: 1, template_id: 1, day_of_week: 1, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" }],
      });

      useScheduleStore.getState().updateBlock(1, { start_min: 600, label: "Morning" });

      const block = useScheduleStore.getState().blocks[0];
      expect(block.start_min).toBe(600);
      expect(block.label).toBe("Morning");
      expect(block.end_min).toBe(1020); // unchanged
    });
  });

  describe("deleteBlock", () => {
    it("removes block and its checklist items", () => {
      useScheduleStore.setState({
        blocks: [
          { id: 1, template_id: 1, day_of_week: 1, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
          { id: 2, template_id: 1, day_of_week: 2, start_min: 540, end_min: 1020, label: "Work", color: "#34D399" },
        ],
        checklistItems: [
          { id: 1, block_id: 1, text: "Task A", position: 0 },
          { id: 2, block_id: 2, text: "Task B", position: 0 },
        ],
        selectedBlockId: 1,
      });

      useScheduleStore.getState().deleteBlock(1);

      const state = useScheduleStore.getState();
      expect(state.blocks).toHaveLength(1);
      expect(state.blocks[0].id).toBe(2);
      expect(state.checklistItems).toHaveLength(1);
      expect(state.checklistItems[0].block_id).toBe(2);
      expect(state.selectedBlockId).toBeNull();
    });
  });

  describe("getDayBlocks", () => {
    it("filters and sorts blocks by day", () => {
      useScheduleStore.setState({
        blocks: [
          { id: 1, template_id: 1, day_of_week: 1, start_min: 800, end_min: 1020, label: "Afternoon", color: "#34D399" },
          { id: 2, template_id: 1, day_of_week: 1, start_min: 540, end_min: 720, label: "Morning", color: "#34D399" },
          { id: 3, template_id: 1, day_of_week: 2, start_min: 540, end_min: 1020, label: "Tuesday", color: "#34D399" },
        ],
      });

      const monday = useScheduleStore.getState().getDayBlocks(1);
      expect(monday).toHaveLength(2);
      expect(monday[0].label).toBe("Morning"); // sorted by start_min
      expect(monday[1].label).toBe("Afternoon");

      const tuesday = useScheduleStore.getState().getDayBlocks(2);
      expect(tuesday).toHaveLength(1);
    });
  });

  describe("addChecklistItem", () => {
    it("adds item with auto-incrementing position", () => {
      useScheduleStore.setState({
        checklistItems: [{ id: 1, block_id: 1, text: "Existing", position: 0 }],
      });

      useScheduleStore.getState().addChecklistItem(1, "New task");

      const items = useScheduleStore.getState().checklistItems;
      expect(items).toHaveLength(2);
      expect(items[1].text).toBe("New task");
      expect(items[1].position).toBe(1);
      expect(items[1].id).toBeLessThan(0);
    });

    it("trims whitespace and rejects empty", () => {
      useScheduleStore.setState({ checklistItems: [] });

      useScheduleStore.getState().addChecklistItem(1, "   ");

      expect(useScheduleStore.getState().checklistItems).toHaveLength(0);
    });
  });

  describe("removeChecklistItem", () => {
    it("removes the item by id", () => {
      useScheduleStore.setState({
        checklistItems: [
          { id: 1, block_id: 1, text: "A", position: 0 },
          { id: 2, block_id: 1, text: "B", position: 1 },
        ],
      });

      useScheduleStore.getState().removeChecklistItem(1);

      expect(useScheduleStore.getState().checklistItems).toHaveLength(1);
      expect(useScheduleStore.getState().checklistItems[0].id).toBe(2);
    });
  });

  describe("save", () => {
    it("filters out blocks where end == start but allows overnight", async () => {
      useScheduleStore.setState({
        activeTemplateId: 1,
        blocks: [
          { id: 1, template_id: 1, day_of_week: 1, start_min: 1020, end_min: 540, label: "Overnight", color: "#34D399" },
          { id: 2, template_id: 1, day_of_week: 1, start_min: 540, end_min: 1020, label: "Good", color: "#34D399" },
          { id: 3, template_id: 1, day_of_week: 1, start_min: 540, end_min: 540, label: "Zero", color: "#34D399" },
        ],
        checklistItems: [],
      });

      mockInvoke
        .mockResolvedValueOnce(undefined) // save_schedule
        .mockResolvedValueOnce({
          templates: [],
          active_template_id: 1,
          blocks: [],
          checklist_items: [],
          day_targets: [],
        }); // get_schedule (reload)

      await useScheduleStore.getState().save();

      const saveCall = mockInvoke.mock.calls[0];
      expect(saveCall[0]).toBe("save_schedule");
      const payload = (saveCall[1] as { payload: { blocks: unknown[] } }).payload;
      expect(payload.blocks).toHaveLength(2); // overnight + normal, zero-duration filtered
    });

    it("sets error when no active template", async () => {
      useScheduleStore.setState({ activeTemplateId: null });

      await useScheduleStore.getState().save();

      expect(useScheduleStore.getState().error).toBe("No active template selected.");
    });
  });
});
