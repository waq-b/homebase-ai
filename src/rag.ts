import { getDb, sanitizeKbName, toVectorBlob } from "./db.js";
import { DEFAULT_EMBEDDING_MODEL } from "./providers.js";
import { embedText } from "./embeddings.js";

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

const createKbConfig = (kbName: string, embeddingModel: string, dimension: number): KbConfig => {
  const vectorTable = `kb_vec_${sanitizeKbName(kbName).replace(/-/g, "_")}`;
  const db = getDb();
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
export const addDocument = async (
  kbName: string,
  text: string,
  options: AddDocumentOptions = {},
): Promise<AddDocumentResult> => {
  sanitizeKbName(kbName);
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("Document has no content to index");

  const existing = getKbConfig(kbName);
  if (existing && options.model && options.model !== existing.embeddingModel) {
    throw new KbModelMismatchError(kbName, existing.embeddingModel, options.model);
  }
  const modelId = existing?.embeddingModel ?? options.model ?? DEFAULT_EMBEDDING_MODEL;

  // Embed the first chunk up front regardless — for a brand-new KB, its
  // vector length is also how we learn the model's dimension to size the table.
  const firstEmbedding = await embedText(chunks[0], modelId);
  const kb = existing ?? createKbConfig(kbName, modelId, firstEmbedding.vector.length);

  const db = getDb();
  const documentInfo = db
    .prepare("INSERT INTO kb_documents (kb_name, metadata) VALUES (?, ?)")
    .run(kbName, options.metadata !== undefined ? JSON.stringify(options.metadata) : null);
  const documentId = Number(documentInfo.lastInsertRowid);

  const insertChunk = db.prepare(
    "INSERT INTO kb_chunks (document_id, kb_name, chunk_index, content) VALUES (?, ?, ?, ?)",
  );
  const insertVector = db.prepare(`INSERT INTO "${kb.vectorTable}" (rowid, embedding) VALUES (?, ?)`);

  for (const [index, chunk] of chunks.entries()) {
    const { vector } = index === 0 ? firstEmbedding : await embedText(chunk, modelId);
    const chunkInfo = insertChunk.run(documentId, kbName, index, chunk);
    insertVector.run(BigInt(chunkInfo.lastInsertRowid), toVectorBlob(vector));
  }

  return { documentId, chunksAdded: chunks.length, embeddingModel: modelId };
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

  const db = getDb();
  let chunksAdded = 0;

  if (options.text !== undefined) {
    deleteDocumentChunks(kb, documentId);

    const chunks = chunkText(options.text);
    const insertChunk = db.prepare(
      "INSERT INTO kb_chunks (document_id, kb_name, chunk_index, content) VALUES (?, ?, ?, ?)",
    );
    const insertVector = db.prepare(`INSERT INTO "${kb.vectorTable}" (rowid, embedding) VALUES (?, ?)`);

    for (const [index, chunk] of chunks.entries()) {
      const { vector } = await embedText(chunk, kb.embeddingModel);
      const chunkInfo = insertChunk.run(documentId, kbName, index, chunk);
      insertVector.run(BigInt(chunkInfo.lastInsertRowid), toVectorBlob(vector));
    }
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
};

export const deleteDocument = (kbName: string, documentId: number): void => {
  const kb = getKbConfig(kbName);
  if (!kb) throw new KbNotFoundError(kbName);
  getDocumentOrThrow(kbName, documentId);

  deleteDocumentChunks(kb, documentId);
  getDb().prepare("DELETE FROM kb_documents WHERE id = ?").run(documentId);
};

export interface DocumentSummary {
  id: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

export const listDocuments = (kbName: string): DocumentSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT kb_documents.id as id, kb_documents.metadata as metadata,
              kb_documents.created_at as createdAt, kb_documents.updated_at as updatedAt,
              COUNT(kb_chunks.id) as chunkCount
       FROM kb_documents
       LEFT JOIN kb_chunks ON kb_chunks.document_id = kb_documents.id
       WHERE kb_documents.kb_name = ?
       GROUP BY kb_documents.id
       ORDER BY kb_documents.id ASC`,
    )
    .all(kbName) as {
    id: number;
    metadata: string | null;
    createdAt: string;
    updatedAt: string;
    chunkCount: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    chunkCount: row.chunkCount,
  }));
};

const matchesFilter = (metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
  Object.entries(filter).every(([key, value]) => metadata[key] === value);

export interface SearchOptions {
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface SearchResult {
  content: string;
  score: number;
  chunkIndex: number;
  documentId: number;
  metadata: unknown;
}

/**
 * Similarity search, optionally narrowed by exact-match metadata filtering
 * (e.g. `{ genre: "action" }`) applied after the vector search. Each KB now
 * has its own vec0 table (see ensureKbConfig/createKbConfig), so — unlike
 * the earlier shared-table version — this doesn't need to over-fetch and
 * filter out other KBs' results; it only over-fetches when a metadata
 * `filter` is given, since sqlite-vec's similarity ranking has no idea about
 * metadata.
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
  const candidatePool = options.filter ? Math.max(topK * 20, 50) : topK;
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
  for (const row of rows) {
    if (results.length >= topK) break;
    const chunk = getChunkWithDoc.get(row.id) as
      | { content: string; chunkIndex: number; documentId: number; metadata: string | null }
      | undefined;
    if (!chunk) continue;

    const metadata = chunk.metadata ? JSON.parse(chunk.metadata) : {};
    if (options.filter && !matchesFilter(metadata, options.filter)) continue;

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
