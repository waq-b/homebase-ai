import { getDb, toVectorBlob } from "./db.js";
import { embedText } from "./embeddings.js";

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

export interface AddDocumentResult {
  chunksAdded: number;
}

/** Chunks + embeds a document, appending it to a named KB. Append-only — no update/delete in v1. */
export const addDocument = async (kbName: string, text: string): Promise<AddDocumentResult> => {
  const db = getDb();
  const chunks = chunkText(text);

  const insertChunk = db.prepare(
    "INSERT INTO kb_chunks (kb_name, chunk_index, content) VALUES (?, ?, ?)",
  );
  const insertVector = db.prepare("INSERT INTO kb_vectors (rowid, embedding) VALUES (?, ?)");

  for (const [index, chunk] of chunks.entries()) {
    const { vector } = await embedText(chunk);
    const info = insertChunk.run(kbName, index, chunk);
    // node:sqlite binds plain JS numbers as REAL; vec0's rowid PK requires an
    // explicit integer binding, hence BigInt here.
    insertVector.run(BigInt(info.lastInsertRowid), toVectorBlob(vector));
  }

  return { chunksAdded: chunks.length };
};

export interface SearchResult {
  content: string;
  score: number;
  chunkIndex: number;
}

/**
 * kb_vectors is one global vec0 table shared by every KB (sqlite-vec's vec0
 * doesn't have first-class per-KB partitioning in this version), so a search
 * pulls more nearest neighbors than requested and filters to the target KB
 * in JS. Fine for v1-scale KBs; revisit (partition key or per-KB table) if
 * a KB ever gets crowded out by a much larger one sharing the vector space.
 */
export const searchKb = async (kbName: string, query: string, topK = 5): Promise<SearchResult[]> => {
  const db = getDb();
  const { vector } = await embedText(query);

  const candidatePool = Math.max(topK * 20, 50);
  const rows = db
    .prepare(
      "SELECT rowid as id, distance FROM kb_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance",
    )
    .all(toVectorBlob(vector), candidatePool) as { id: number; distance: number }[];

  const getChunk = db.prepare("SELECT kb_name, chunk_index, content FROM kb_chunks WHERE id = ?");

  const results: SearchResult[] = [];
  for (const row of rows) {
    if (results.length >= topK) break;
    const chunk = getChunk.get(row.id) as
      | { kb_name: string; chunk_index: number; content: string }
      | undefined;
    if (chunk && chunk.kb_name === kbName) {
      results.push({ content: chunk.content, score: row.distance, chunkIndex: chunk.chunk_index });
    }
  }

  return results;
};
