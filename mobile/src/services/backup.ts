import { File, Paths, Directory } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { closeDb, reopenDb, DB_NAME } from "../db/connection";

const REQUIRED_TABLES = [
  "session",
  "schedule_template",
  "schedule_block",
  "daily_task",
  "settings",
  "app_meta",
];

function getDbFile(): File {
  return new File(Paths.document, "SQLite", DB_NAME);
}

export async function exportDatabase(): Promise<void> {
  const db = await (await import("../db/connection")).getDb();
  await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");

  const dbFile = getDbFile();
  if (!dbFile.exists) {
    throw new Error("Database file not found. Nothing to export.");
  }

  const exportFile = new File(Paths.cache, "clockwise-export.db");
  if (exportFile.exists) exportFile.delete();
  dbFile.copy(exportFile);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing is not available on this device.");
  }

  await Sharing.shareAsync(exportFile.uri, {
    mimeType: "application/x-sqlite3",
    dialogTitle: "Export Clockwise Database",
    UTI: "public.database",
  });
}

export async function importDatabase(): Promise<{ success: boolean; error?: string }> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { success: false, error: "No file selected." };
  }

  const sourceFile = new File(result.assets[0].uri);
  if (!sourceFile.exists) {
    return { success: false, error: "Selected file does not exist." };
  }

  const validationError = await validateDatabaseFile(sourceFile);
  if (validationError) {
    return { success: false, error: validationError };
  }

  await closeDb();

  const dbFile = getDbFile();
  const walFile = new File(dbFile.uri + "-wal");
  const shmFile = new File(dbFile.uri + "-shm");
  if (walFile.exists) walFile.delete();
  if (shmFile.exists) shmFile.delete();
  if (dbFile.exists) dbFile.delete();

  sourceFile.copy(dbFile);

  await reopenDb();

  return { success: true };
}

async function validateDatabaseFile(file: File): Promise<string | null> {
  try {
    if (file.size < 4096) {
      return "File is too small to be a valid database.";
    }

    const handle = file.open();
    try {
      const headerBytes = handle.readBytes(16);
      const header = new TextDecoder().decode(headerBytes);
      if (!header.startsWith("SQLite format 3")) {
        return "Not a valid SQLite database file.";
      }
    } finally {
      handle.close();
    }
  } catch {
    return "Could not read file. Make sure it's a valid .db file.";
  }

  try {
    const SQLite = await import("expo-sqlite");
    const tempName = `_validate_import_${Date.now()}.db`;

    const sqliteDir = new Directory(Paths.document, "SQLite");
    if (!sqliteDir.exists) sqliteDir.create({ intermediates: true });

    const tempFile = new File(sqliteDir, tempName);
    if (tempFile.exists) tempFile.delete();
    file.copy(tempFile);

    const tempDb = await SQLite.openDatabaseAsync(tempName);
    try {
      const rows = await tempDb.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      const tableNames = rows.map((r) => r.name);
      const missing = REQUIRED_TABLES.filter((t) => !tableNames.includes(t));
      if (missing.length > 0) {
        return `Invalid Clockwise database. Missing tables: ${missing.join(", ")}`;
      }
    } finally {
      await tempDb.closeAsync();
      if (tempFile.exists) tempFile.delete();
    }
  } catch (e) {
    return `Database validation failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  return null;
}
