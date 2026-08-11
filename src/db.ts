import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

let db: DatabaseSync | undefined;

/**
 * Lazily opens the single Homebase SQLite file (+ sqlite-vec extension for RAG).
 * Uses node:sqlite (built-in, experimental as of Node 22-24) — avoids a native
 * dependency like better-sqlite3. Schema is created on first open, idempotently.
 *
 * kb_vectors is NOT a fixed global table — each KB gets its own vec0 table
 * (see rag.ts, ensureKbConfig), sized to whatever embedding model that KB was
 * first written with. kb_config tracks which table + model + dimension a KB
 * uses, so a KB embed-model override is possible without every KB being
 * forced onto one shared vector width.
 */
export const getDb = (): DatabaseSync => {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "homebase.db"), { allowExtension: true });
  db.enableLoadExtension(true);
  db.loadExtension(sqliteVec.getLoadablePath());
  db.enableLoadExtension(false);

  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_config (
      kb_name TEXT PRIMARY KEY,
      embedding_model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_table TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kb_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_name TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_documents_kb_name ON kb_documents(kb_name);

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES kb_documents(id),
      kb_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb_name ON kb_chunks(kb_name);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_document_id ON kb_chunks(document_id);

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

/**
 * A KB name becomes part of a SQL identifier (its dedicated vec0 table name),
 * so it's validated against a strict allowlist rather than escaped — safer
 * than trying to quote-escape an identifier correctly.
 */
export const sanitizeKbName = (kbName: string): string => {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(kbName)) {
    throw new InvalidKbNameError(kbName);
  }
  return kbName;
};

export class InvalidKbNameError extends Error {
  constructor(public readonly kbName: string) {
    super(
      `Invalid KB name "${kbName}": must start with a letter and contain only letters, numbers, "_", "-" (max 64 chars)`,
    );
    this.name = "InvalidKbNameError";
  }
}
