import * as SQLite from "expo-sqlite";
import { initDb } from "./schema";

let _db: SQLite.SQLiteDatabase | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;

  _dbPromise = (async () => {
    const db = await SQLite.openDatabaseAsync("clockwise.db");
    await initDb(db);
    _db = db;
    return db;
  })();

  return _dbPromise;
}
