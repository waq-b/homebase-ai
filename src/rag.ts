import { getDb, sanitizeKbName, toVectorBlob } from "./db.js";
import { DEFAULT_EMBEDDING_MODEL } from "./providers.js";
import { embedText, embedTexts } from "./embeddings.js";

export class KbNotFoundError extends Error {
  constructor(public readonly kbName: string) {
    super(`Knowledge base "${kbName}" doesn't exist yet — add a document to create it`);
    this.name = "KbNotFoundError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor(
    public readonly kbName: string,
    public readonly documentId: number,
  ) {
    super(`Document ${documentId} not found in KB "${kbName}"`);
    this.name = "DocumentNotFoundError";
  }
}

export class KbModelMismatchError extends Error {
  constructor(kbName: string, existingModel: string, requestedModel: string) {
    super(
      `KB "${kbName}" was created with embedding model "${existingModel}" and can't switch to "${requestedModel}" — a KB's embedding model is fixed at creation (its vector table is sized to that model's dimension). Use a new KB name to start over with a different model.`,
    );
    this.name = "KbModelMismatchError";
  }
}

export class KbNameCollisionError extends Error {
  constructor(
    public readonly kbName: string,
    public readonly collidesWith: string,
  ) {
    super(
      `KB name "${kbName}" collides with existing KB "${collidesWith}" — both sanitize to the same underlying vector table (names differing only by "-"/"_" aren't distinct). Pick a different name.`,
    );
    this.name = "KbNameCollisionError";
  }
}

export class EmptyDocumentError extends Error {
  constructor() {
    super("Document has no content to index (text is empty or whitespace-only)");
    this.name = "EmptyDocumentError";
  }
}

const CHUNK_SIZE = 800;

/**
 * Fixed-size chunking, paragraph-aware. Deliberately simple for v1 — no
 * semantic chunking, no overlap. Revisit if retrieval quality demands it.
 */
export const chunkText = (text: string): string[] => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= CHUNK_SIZE) {
      chunks.push(paragraph);
      continue;
    }
    for (let i = 0; i < paragraph.length; i += CHUNK_SIZE) {
      chunks.push(paragraph.slice(i, i + CHUNK_SIZE));
    }
  }

  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
};

interface KbConfig {
  kbName: string;
  embeddingModel: string;
  dimension: number;
  vectorTable: string;
}

export const getKbConfig = (kbName: string): KbConfig | undefined => {
  const row = getDb()
    .prepare("SELECT kb_name, embedding_model, dimension, vector_table FROM kb_config WHERE kb_name = ?")
    .get(kbName) as
    | { kb_name: string; embedding_model: string; dimension: number; vector_table: string }
    | undefined;
  if (!row) return undefined;
  return {
    kbName: row.kb_name,
    embeddingModel: row.embedding_model,
    dimension: row.dimension,
    vectorTable: row.vector_table,
  };
};

export interface KbSummary {
  name: string;
  embeddingModel: string;
  dimension: number;
  documentCount: number;
  chunkCount: number;
}

export const listKbs = (): KbSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT kb_config.kb_name as name, kb_config.embedding_model as embeddingModel,
              kb_config.dimension as dimension,
              COUNT(DISTINCT kb_documents.id) as documentCount,
              COUNT(kb_chunks.id) as chunkCount
       FROM kb_config
       LEFT JOIN kb_documents ON kb_documents.kb_name = kb_config.kb_name
       LEFT JOIN kb_chunks ON kb_chunks.document_id = kb_documents.id
       GROUP BY kb_config.kb_name
       ORDER BY kb_config.kb_name ASC`,
    )
    .all() as unknown as KbSummary[];
  return rows;
};

/**
 * Runs `fn` inside a BEGIN/COMMIT, rolling back on any throw so a mid-write
 * failure (e.g. an embedding call that rejects partway through) can't orphan
 * chunk rows or vector rows relative to each other.
 */
const withTransaction = <T>(fn: () => T): T => {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

const createKbConfig = (kbName: string, embeddingModel: string, dimension: number): KbConfig => {
  const vectorTable = `kb_vec_${sanitizeKbName(kbName).replace(/-/g, "_")}`;
  const db = getDb();

  const collision = db
    .prepare("SELECT kb_name FROM kb_config WHERE vector_table = ?")
    .get(vectorTable) as { kb_name: string } | undefined;
  if (collision) throw new KbNameCollisionError(kbName, collision.kb_name);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS "${vectorTable}" USING vec0(embedding float[${dimension}])`);
  db.prepare(
    "INSERT INTO kb_config (kb_name, embedding_model, dimension, vector_table) VALUES (?, ?, ?, ?)",
  ).run(kbName, embeddingModel, dimension, vectorTable);
  return { kbName, embeddingModel, dimension, vectorTable };
};

export interface AddDocumentOptions {
  metadata?: unknown;
  model?: string;
}

export interface AddDocumentResult {
  documentId: number;
  chunksAdded: number;
  embeddingModel: string;
}

/**
 * Chunks + embeds a document, appending it as a new document in a named KB.
 * A KB's embedding model is decided by whichever call creates it (first
 * document written to that name) and is fixed after that — its vector table
 * is sized to that model's output dimension, so later calls can't silently
 * switch models without corrupting the table shape. Pass `model` to choose
 * it up front for a brand-new KB; omit to use the default.
 */
/** Shared by addDocument/updateDocument — inserts each chunk's row + its vector, in lockstep with `vectors[i]`. */
const insertChunks = (
  kb: KbConfig,
  kbName: string,
  documentId: number,
  chunks: string[],
  vectors: number[][],
): void => {
  const db = getDb();
  const insertChunk = db.prepare(
    "INSERT INTO kb_chunks (document_id, kb_name, chunk_index, content) VALUES (?, ?, ?, ?)",
  );
  const insertVector = db.prepare(`INSERT INTO "${kb.vectorTable}" (rowid, embedding) VALUES (?, ?)`);

  for (const [index, chunk] of chunks.entries()) {
    const chunkInfo = insertChunk.run(documentId, kbName, index, chunk);
    insertVector.run(BigInt(chunkInfo.lastInsertRowid), toVectorBlob(vectors[index]));
  }
};

export const addDocument = async (
  kbName: string,
  text: string,
  options: AddDocumentOptions = {},
): Promise<AddDocumentResult> => {
  sanitizeKbName(kbName);
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new EmptyDocumentError();

  const existing = getKbConfig(kbName);
  if (existing && options.model && options.model !== existing.embeddingModel) {
    throw new KbModelMismatchError(kbName, existing.embeddingModel, options.model);
  }
  const modelId = existing?.embeddingModel ?? options.model ?? DEFAULT_EMBEDDING_MODEL;

  // One batched call for every chunk (real single HTTP round trip to Ollama,
  // see embedTexts) instead of one embed call per chunk — for a brand-new
  // KB, the first vector's length is also how we learn the model's
  // dimension to size the table.
  const { vectors } = await embedTexts(chunks, modelId);

  return withTransaction(() => {
    const kb = existing ?? createKbConfig(kbName, modelId, vectors[0].length);

    const documentInfo = getDb()
      .prepare("INSERT INTO kb_documents (kb_name, metadata) VALUES (?, ?)")
      .run(kbName, options.metadata !== undefined ? JSON.stringify(options.metadata) : null);
    const documentId = Number(documentInfo.lastInsertRowid);

    insertChunks(kb, kbName, documentId, chunks, vectors);

    return { documentId, chunksAdded: chunks.length, embeddingModel: modelId };
  });
};

const deleteDocumentChunks = (kb: KbConfig, documentId: number) => {
  const db = getDb();
  const chunkIds = db.prepare("SELECT id FROM kb_chunks WHERE document_id = ?").all(documentId) as {
    id: number;
  }[];
  const deleteVector = db.prepare(`DELETE FROM "${kb.vectorTable}" WHERE rowid = ?`);
  for (const { id } of chunkIds) deleteVector.run(BigInt(id));
  db.prepare("DELETE FROM kb_chunks WHERE document_id = ?").run(documentId);
};

const getDocumentOrThrow = (kbName: string, documentId: number) => {
  const doc = getDb()
    .prepare("SELECT id FROM kb_documents WHERE id = ? AND kb_name = ?")
    .get(documentId, kbName);
  if (!doc) throw new DocumentNotFoundError(kbName, documentId);
};

export interface UpdateDocumentOptions {
  text?: string;
  metadata?: unknown;
}

export interface UpdateDocumentResult {
  documentId: number;
  chunksAdded: number;
}

/**
 * Re-syncs a stale entry: replaces a document's chunks/embeddings (if `text`
 * given) and/or its metadata (if `metadata` given). Re-embeds with the KB's
 * existing (fixed) model — there's no per-call model override here, only at
 * KB-creation time via addDocument.
 */
export const updateDocument = async (
  kbName: string,
  documentId: number,
  options: UpdateDocumentOptions,
): Promise<UpdateDocumentResult> => {
  if (options.text === undefined && options.metadata === undefined) {
    throw new Error("Provide at least one of text or metadata to update");
  }

  const kb = getKbConfig(kbName);
  if (!kb) throw new KbNotFoundError(kbName);
  getDocumentOrThrow(kbName, documentId);

  let chunks: string[] | undefined;
  let vectors: number[][] | undefined;
  if (options.text !== undefined) {
    chunks = chunkText(options.text);
    if (chunks.length === 0) throw new EmptyDocumentError();
    // Validated before touching existing chunks — a rejected update should
    // never leave the document with its old chunks deleted and nothing to
    // replace them.
    ({ vectors } = await embedTexts(chunks, kb.embeddingModel));
  }

  return withTransaction(() => {
    const db = getDb();
    let chunksAdded = 0;

    if (chunks && vectors) {
      deleteDocumentChunks(kb, documentId);
      insertChunks(kb, kbName, documentId, chunks, vectors);
      chunksAdded = chunks.length;
    }

    if (options.metadata !== undefined) {
      db.prepare("UPDATE kb_documents SET metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(options.metadata),
        documentId,
      );
    } else {
      db.prepare("UPDATE kb_documents SET updated_at = datetime('now') WHERE id = ?").run(documentId);
    }

    return { documentId, chunksAdded };
  });
};

export const deleteDocument = (kbName: string, documentId: number): void => {
  const kb = getKbConfig(kbName);
  if (!kb) throw new KbNotFoundError(kbName);
  getDocumentOrThrow(kbName, documentId);

  withTransaction(() => {
    deleteDocumentChunks(kb, documentId);
    getDb().prepare("DELETE FROM kb_documents WHERE id = ?").run(documentId);
  });
};

/** Drops a KB entirely — its dedicated vec0 table, every document/chunk row, and its kb_config row. */
export const deleteKb = (kbName: string): void => {
  const kb = getKbConfig(kbName);
  if (!kb) throw new KbNotFoundError(kbName);

  withTransaction(() => {
    const db = getDb();
    db.exec(`DROP TABLE IF EXISTS "${kb.vectorTable}"`);
    db.prepare(
      "DELETE FROM kb_chunks WHERE document_id IN (SELECT id FROM kb_documents WHERE kb_name = ?)",
    ).run(kbName);
    db.prepare("DELETE FROM kb_documents WHERE kb_name = ?").run(kbName);
    db.prepare("DELETE FROM kb_config WHERE kb_name = ?").run(kbName);
  });
};

export interface DocumentSummary {
  id: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

export interface ListDocumentsOptions {
  limit?: number;
  offset?: number;
}

export interface ListDocumentsResult {
  documents: DocumentSummary[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIST_LIMIT = 100;

export const listDocuments = (kbName: string, options: ListDocumentsOptions = {}): ListDocumentsResult => {
  sanitizeKbName(kbName);
  if (!getKbConfig(kbName)) throw new KbNotFoundError(kbName);

  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  const offset = options.offset ?? 0;
  const db = getDb();

  const { total } = db
    .prepare("SELECT COUNT(*) as total FROM kb_documents WHERE kb_name = ?")
    .get(kbName) as { total: number };

  const rows = db
    .prepare(
      `SELECT kb_documents.id as id, kb_documents.metadata as metadata,
              kb_documents.created_at as createdAt, kb_documents.updated_at as updatedAt,
              COUNT(kb_chunks.id) as chunkCount
       FROM kb_documents
       LEFT JOIN kb_chunks ON kb_chunks.document_id = kb_documents.id
       WHERE kb_documents.kb_name = ?
       GROUP BY kb_documents.id
       ORDER BY kb_documents.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(kbName, limit, offset) as {
    id: number;
    metadata: string | null;
    createdAt: string;
    updatedAt: string;
    chunkCount: number;
  }[];

  const documents = rows.map((row) => ({
    id: row.id,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    chunkCount: row.chunkCount,
  }));

  return { documents, total, limit, offset };
};

export interface DocumentDetail {
  id: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  /** Chunks in index order, rejoined — the closest thing to "the document's original text" this schema stores. */
  content: string;
}

/** Full content for one document — `listDocuments` deliberately omits this (a list of every chunk's text doesn't scale), so fetch it per-document when actually needed. */
export const getDocument = (kbName: string, documentId: number): DocumentDetail => {
  sanitizeKbName(kbName);
  if (!getKbConfig(kbName)) throw new KbNotFoundError(kbName);
  getDocumentOrThrow(kbName, documentId);

  const db = getDb();
  const doc = db
    .prepare(
      "SELECT id, metadata, created_at as createdAt, updated_at as updatedAt FROM kb_documents WHERE id = ?",
    )
    .get(documentId) as { id: number; metadata: string | null; createdAt: string; updatedAt: string };

  const chunks = db
    .prepare("SELECT content FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index ASC")
    .all(documentId) as { content: string }[];

  return {
    id: doc.id,
    metadata: doc.metadata ? JSON.parse(doc.metadata) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    content: chunks.map((c) => c.content).join("\n\n"),
  };
};

const matchesFilter = (metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
  Object.entries(filter).every(([key, value]) => metadata[key] === value);

export interface SearchOptions {
  topK?: number;
  filter?: Record<string, unknown>;
  /**
   * sqlite-vec's KNN search always returns the K nearest neighbors, even
   * when none are actually relevant to the query — there's no built-in
   * "not relevant enough" cutoff. Pass a max distance (lower = closer/more
   * relevant) to drop anything beyond it. No default here — what counts as
   * "relevant" depends on the embedding model and the KB's content, so
   * callers calibrate their own threshold empirically rather than Homebase
   * guessing one.
   */
  maxDistance?: number;
}

export interface SearchResult {
  content: string;
  score: number;
  chunkIndex: number;
  documentId: number;
  metadata: unknown;
}

/**
 * Similarity search, always deduplicated to one result per document (the
 * best/lowest-distance chunk) — a document with several matching chunks
 * would otherwise crowd out `topK` with repeats of itself, which is never
 * what a caller wants from a document-level search. Optionally narrowed by
 * exact-match metadata filtering (e.g. `{ genre: "action" }`) and/or a
 * `maxDistance` cutoff, both applied after the vector search since
 * sqlite-vec's ranking has no idea about metadata or relevance cutoffs.
 *
 * Each KB has its own vec0 table (see createKbConfig), so this doesn't need
 * to over-fetch and filter out other KBs' results — it over-fetches purely
 * to leave enough candidates for dedup/filter/threshold to still surface a
 * full `topK` unique documents.
 */
export const searchKb = async (
  kbName: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> => {
  const kb = getKbConfig(kbName);
  if (!kb) throw new KbNotFoundError(kbName);

  const topK = options.topK ?? 5;
  const { vector } = await embedText(query, kb.embeddingModel);

  const db = getDb();
  // Dedup alone can shrink several chunks down to one result, so this always
  // over-fetches — not just when a metadata filter is given.
  const candidatePool = Math.max(topK * 20, 50);
  const rows = db
    .prepare(`SELECT rowid as id, distance FROM "${kb.vectorTable}" WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
    .all(toVectorBlob(vector), candidatePool) as { id: number; distance: number }[];

  const getChunkWithDoc = db.prepare(
    `SELECT kb_chunks.content as content, kb_chunks.chunk_index as chunkIndex,
            kb_chunks.document_id as documentId, kb_documents.metadata as metadata
     FROM kb_chunks JOIN kb_documents ON kb_documents.id = kb_chunks.document_id
     WHERE kb_chunks.id = ?`,
  );

  const results: SearchResult[] = [];
  const seenDocuments = new Set<number>();

  for (const row of rows) {
    if (results.length >= topK) break;
    if (options.maxDistance !== undefined && row.distance > options.maxDistance) break;

    const chunk = getChunkWithDoc.get(row.id) as
      | { content: string; chunkIndex: number; documentId: number; metadata: string | null }
      | undefined;
    if (!chunk) continue;
    // Rows arrive pre-sorted by distance ascending, so the first chunk seen
    // for a document is already its best-scoring one.
    if (seenDocuments.has(chunk.documentId)) continue;

    const metadata = chunk.metadata ? JSON.parse(chunk.metadata) : {};
    if (options.filter && !matchesFilter(metadata, options.filter)) continue;

    seenDocuments.add(chunk.documentId);
    results.push({
      content: chunk.content,
      score: row.distance,
      chunkIndex: chunk.chunkIndex,
      documentId: chunk.documentId,
      metadata: chunk.metadata ? metadata : null,
    });
  }

  return results;
};
