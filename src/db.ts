import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

/** Dimension of `nomic-embed-text` output — the kb_vectors table shape is fixed to this. */
export const EMBEDDING_DIM = 768;

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

let db: DatabaseSync | undefined;

/**
 * Lazily opens the single Homebase SQLite file (+ sqlite-vec extension for RAG).
 * Uses node:sqlite (built-in, experimental as of Node 22-24) — avoids a native
 * dependency like better-sqlite3. Schema is created on first open, idempotently.
 */
export const getDb = (): DatabaseSync => {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "homebase.db"), { allowExtension: true });
  db.enableLoadExtension(true);
  db.loadExtension(sqliteVec.getLoadablePath());
  db.enableLoadExtension(false);

  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb_name ON kb_chunks(kb_name);

    CREATE VIRTUAL TABLE IF NOT EXISTS kb_vectors USING vec0(embedding float[${EMBEDDING_DIM}]);

    CREATE TABLE IF NOT EXISTS memory_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_turns_conversation_id ON memory_turns(conversation_id);
  `);

  return db;
};

/** sqlite-vec wants embeddings as a packed float32 BLOB, not a JS array. */
export const toVectorBlob = (vector: readonly number[]): Buffer => Buffer.from(new Float32Array(vector).buffer);
