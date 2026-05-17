import * as SQLite from "expo-sqlite";
import { initDb } from "./schema";

export const DB_NAME = "clockwise.db";

let _db: SQLite.SQLiteDatabase | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;

  _dbPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await initDb(db);
    _db = db;
    return db;
  })();

  return _dbPromise;
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.closeAsync();
    _db = null;
    _dbPromise = null;
  }
}

export async function reopenDb(): Promise<SQLite.SQLiteDatabase> {
  _db = null;
  _dbPromise = null;
  return getDb();
}
