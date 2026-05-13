import { getDb } from "../db/connection";
import type {
  BlockChecklistItem,
  DayTarget,
  SaveSchedulePayload,
  ScheduleBlock,
  SchedulePayload,
  ScheduleTemplate,
} from "../types";

function nowMs(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

async function activeTemplateId(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1"
  );
  if (!row) throw new Error("No active schedule template.");
  return row.id;
}

export async function getSchedule(): Promise<SchedulePayload> {
  const db = await getDb();

  const templateRows = await db.getAllAsync<{
    id: number;
    name: string;
    is_active: number;
  }>("SELECT id, name, is_active FROM schedule_template ORDER BY created_at, id");

  const templates: ScheduleTemplate[] = templateRows.map((row) => ({
    id: row.id,
    name: row.name,
    is_active: row.is_active !== 0,
  }));

  const activeId = await activeTemplateId();

  const blockRows = await db.getAllAsync<{
    id: number;
    template_id: number;
    day_of_week: number;
    start_min: number;
    end_min: number;
    label: string;
    color: string;
  }>(
    `SELECT id, template_id, day_of_week, start_min, end_min,
            COALESCE(label, 'Work block') AS label,
            COALESCE(color, '#34D399') AS color
     FROM schedule_block WHERE template_id = ? ORDER BY day_of_week, start_min, id`,
    [activeId]
  );

  const blocks: ScheduleBlock[] = blockRows.map((row) => ({
    id: row.id,
    template_id: row.template_id,
    day_of_week: row.day_of_week,
    start_min: row.start_min,
    end_min: row.end_min,
    label: row.label,
    color: row.color,
  }));

  const checklistRows = await db.getAllAsync<{
    id: number;
    block_id: number;
    text: string;
    position: number;
  }>(
    `SELECT i.id, i.block_id, i.text, i.position
     FROM block_checklist_item i
     JOIN schedule_block b ON b.id = i.block_id
     WHERE b.template_id = ?
     ORDER BY i.block_id, i.position, i.id`,
    [activeId]
  );

  const checklist_items: BlockChecklistItem[] = checklistRows.map((row) => ({
    id: row.id,
    block_id: row.block_id,
    text: row.text,
    position: row.position,
  }));

  const targetRows = await db.getAllAsync<{ day_of_week: number; target_min: number }>(
    "SELECT day_of_week, target_min FROM schedule_day_target WHERE template_id = ? ORDER BY day_of_week",
    [activeId]
  );

  const day_targets: DayTarget[] = targetRows.map((row) => ({
    day_of_week: row.day_of_week,
    target_min: row.target_min,
  }));

  return {
    templates,
    active_template_id: activeId,
    blocks,
    checklist_items,
    day_targets,
  };
}

function validateBlock(block: ScheduleBlock): void {
  if (block.day_of_week < 0 || block.day_of_week > 6) throw new Error("Invalid day in schedule.");
  if (
    block.start_min < 0 ||
    block.end_min < 0 ||
    block.start_min > 1440 ||
    block.end_min > 1440 ||
    block.start_min === block.end_min
  ) {
    throw new Error("Invalid start/end time in schedule.");
  }
}

export async function saveSchedule(payload: SaveSchedulePayload): Promise<void> {
  const db = await getDb();

  await db.runAsync("BEGIN IMMEDIATE");
  try {
    const existingIds = payload.blocks.filter((b) => b.id > 0).map((b) => b.id);
    if (existingIds.length === 0) {
      await db.runAsync("DELETE FROM schedule_block WHERE template_id = ?", [payload.template_id]);
    } else {
      const placeholders = existingIds.map(() => "?").join(",");
      await db.runAsync(
        `DELETE FROM schedule_block WHERE template_id = ? AND id NOT IN (${placeholders})`,
        [payload.template_id, ...existingIds]
      );
    }

    for (const block of payload.blocks) {
      validateBlock(block);
      if (block.id > 0) {
        await db.runAsync(
          `UPDATE schedule_block
           SET day_of_week = ?, start_min = ?, end_min = ?, label = ?, color = ?
           WHERE id = ? AND template_id = ?`,
          [
            block.day_of_week,
            block.start_min,
            block.end_min,
            block.label,
            block.color,
            block.id,
            payload.template_id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO schedule_block (template_id, day_of_week, start_min, end_min, label, color)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            payload.template_id,
            block.day_of_week,
            block.start_min,
            block.end_min,
            block.label,
            block.color,
          ]
        );
      }
    }

    await db.runAsync(
      `DELETE FROM block_checklist_item
       WHERE block_id IN (SELECT id FROM schedule_block WHERE template_id = ?)`,
      [payload.template_id]
    );

    const persistedRows = await db.getAllAsync<{
      id: number;
      day_of_week: number;
      start_min: number;
      end_min: number;
      label: string;
      color: string;
    }>(
      `SELECT id, day_of_week, start_min, end_min, COALESCE(label, ''), COALESCE(color, '')
       FROM schedule_block
       WHERE template_id = ?`,
      [payload.template_id]
    );

    const persistedBlocks: [number, number, number, number, string, string][] = persistedRows.map((row) => [
      row.id,
      row.day_of_week,
      row.start_min,
      row.end_min,
      row.label,
      row.color,
    ]);

    for (const item of payload.checklist_items) {
      let targetBlockId = 0;
      if (item.block_id > 0) {
        targetBlockId = item.block_id;
      } else {
        const srcBlock = payload.blocks.find((b) => b.id === item.block_id);
        if (srcBlock) {
          const match = persistedBlocks.find(
            ([, day, start, end, label, color]) =>
              day === srcBlock.day_of_week &&
              start === srcBlock.start_min &&
              end === srcBlock.end_min &&
              label === srcBlock.label &&
              color === srcBlock.color
          );
          targetBlockId = match ? match[0] : 0;
        }
      }

      if (targetBlockId > 0) {
        await db.runAsync("INSERT INTO block_checklist_item (block_id, text, position) VALUES (?, ?, ?)", [
          targetBlockId,
          item.text,
          item.position,
        ]);
      }
    }

    await db.runAsync("DELETE FROM schedule");

    for (let day = 0; day <= 6; day++) {
      let dayBlocks = payload.blocks.filter((b) => b.day_of_week === day);
      dayBlocks = [...dayBlocks].sort((a, b) => a.start_min - b.start_min);
      const first = dayBlocks[0];
      if (first) {
        const end = Math.max(...dayBlocks.map((b) => b.end_min));
        await db.runAsync("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, 1, ?, ?)", [
          day,
          first.start_min,
          end,
        ]);
      } else {
        await db.runAsync("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, 0, 540, 1020)", [
          day,
        ]);
      }
    }

    await db.runAsync("COMMIT");
  } catch (e) {
    await db.runAsync("ROLLBACK");
    throw e;
  }
}

export async function createTemplate(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Template name cannot be empty.");
  const db = await getDb();
  const result = await db.runAsync(
    "INSERT INTO schedule_template (name, is_active, created_at) VALUES (?, 0, ?)",
    [trimmed, nowMs()]
  );
  return Number(result.lastInsertRowId);
}

export async function activateTemplate(templateId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE schedule_template SET is_active = 0");
  await db.runAsync("UPDATE schedule_template SET is_active = 1 WHERE id = ?", [templateId]);
}

export async function saveDayTargets(templateId: number, targets: DayTarget[]): Promise<void> {
  const db = await getDb();
  for (const t of targets) {
    if (t.day_of_week < 0 || t.day_of_week > 6) throw new Error("Invalid day_of_week");
    await db.runAsync(
      `INSERT INTO schedule_day_target (template_id, day_of_week, target_min)
       VALUES (?, ?, ?)
       ON CONFLICT(template_id, day_of_week) DO UPDATE SET target_min = excluded.target_min`,
      [templateId, t.day_of_week, Math.max(0, t.target_min)]
    );
  }
}
