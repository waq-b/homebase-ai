# RAG (knowledge bases)

Deep reference for the `/kb/*` routes (`src/rag.ts`), added in v2.2 and extended shortly after with metadata filtering, update/delete, and per-KB embedding model override. Depends on the embedding endpoint (`docs/embeddings.md`) for vectorization.

## What it's for

Homebase-hosted retrieval: apps create named knowledge bases (e.g. `"manga-kb"`, `"homebase-docs-kb"`), push documents in, and query by similarity search. KBs are namespaced by name — no cross-KB search.

## Storage

SQLite (via Node's built-in `node:sqlite`, no native dependency) + the [`sqlite-vec`](https://github.com/asg017/sqlite-vec) extension for vector search, in `data/homebase.db` (created on first use, gitignored).

**Each KB gets its own dedicated `vec0` table**, sized to whichever embedding model that KB was first written with (`kb_config` tracks `kb_name -> embedding_model, dimension, vector_table`). This is what makes the per-KB embedding model override (below) possible — a shared table would force every KB onto one fixed vector width.

Tables (`src/db.ts`):
- `kb_config` — `(kb_name, embedding_model, dimension, vector_table)`, one row per KB
- `kb_documents` — `(id, kb_name, metadata, created_at, updated_at)`, one row per document
- `kb_chunks` — `(id, document_id, kb_name, chunk_index, content, created_at)`, one row per chunk
- `kb_vec_<name>` — one `vec0` virtual table per KB, `rowid` matching `kb_chunks.id`

## Add a document

```bash
curl localhost:3000/kb/manga-kb/documents \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"Solo Leveling is a manhwa about...", "metadata":{"title":"Solo Leveling","genre":"action"}}'
```

```json
{ "documentId": 1, "chunksAdded": 1, "embeddingModel": "nomic-embed-text" }
```

- `text` (required): chunked and embedded automatically — no separate embed step needed.
- `metadata` (optional): arbitrary JSON, stored per-document. Filterable at search time (below).
- `model` (optional): **only meaningful the first time a KB name is used.** See "Embedding model override."

### Chunking

Fixed-size, paragraph-aware (`chunkText` in `src/rag.ts`): splits on blank lines first, then further splits any paragraph over 800 characters into fixed 800-char pieces. Deliberately simple — no semantic chunking, no overlap between chunks.

All of a document's chunks are embedded in **one batched call** (`embedTexts`, see `docs/embeddings.md`) — a real single HTTP round trip to Ollama regardless of chunk count, not one request per chunk. Matters for documents with many chunks and for bulk-ingestion pipelines adding many documents in a row.

## List documents

```bash
curl "localhost:3000/kb/manga-kb/documents?limit=50&offset=0"
```

```json
{ "documents": [{ "id": 1, "metadata": {...}, "createdAt": "...", "updatedAt": "...", "chunkCount": 1 }], "total": 1, "limit": 100, "offset": 0 }
```

- `limit` (optional, default 100, max 500)
- `offset` (optional, default 0)

`total` is the KB's full document count (independent of `limit`/`offset`), so a caller can tell whether it's seen everything. Defaults are generous enough that small/moderate KBs don't need to think about pagination at all — only relevant once a KB grows past ~100 documents.

## Update a document

```bash
curl localhost:3000/kb/manga-kb/documents/1 \
  -X PUT -H 'content-type: application/json' \
  -d '{"text":"...updated synopsis...", "metadata":{"title":"Solo Leveling","genre":"action","status":"completed"}}'
```

```json
{ "documentId": 1, "chunksAdded": 3 }
```

Both `text` and `metadata` are optional, but at least one is required. Sending `text` deletes the document's old chunks/vectors and re-chunks + re-embeds the new text (using the KB's fixed embedding model — no per-update model override). Sending `metadata` without `text` just updates the metadata in place. `updatedAt` bumps either way.

This is the "re-sync a stale entry" path — there's no diffing, an update fully replaces a document's content.

## Delete a document

```bash
curl -X DELETE localhost:3000/kb/manga-kb/documents/1
# { "deleted": true }
```

Removes the document row, its chunks, and their vectors. `404` if the KB or document doesn't exist.

## Search

```bash
curl localhost:3000/kb/manga-kb/search \
  -X POST -H 'content-type: application/json' \
  -d '{"query":"strongest hunter leveling system","topK":5,"filter":{"genre":"action"},"maxDistance":0.85}'
```

```json
{ "results": [{ "content": "...", "score": 0.74, "chunkIndex": 0, "documentId": 1, "metadata": {...} }] }
```

- `query` (required)
- `topK` (optional, default 5, max 500)
- `filter` (optional): **exact-match** key/value pairs checked against each result's `metadata`, e.g. `{"genre":"action"}`. No range queries, no partial match, no OR — just equality on every key given, and no array-contains (a `genres: string[]` metadata value can't be matched this way — filter client-side on results if you need that). Applied *after* the vector similarity search (sqlite-vec has no notion of metadata).
- `maxDistance` (optional, no default): drops any result whose distance exceeds this. **Why no default**: sqlite-vec's KNN search always returns the `topK` nearest neighbors even when none of them are actually relevant to the query — there's no built-in "not relevant enough" cutoff, so a query with no real matches still returns *something* unless you supply a threshold. What counts as "relevant" is empirical, though — it depends on the embedding model and the KB's actual content, so Homebase doesn't guess one; calibrate by looking at real distances for known-relevant vs. known-irrelevant queries against your own KB. (Reference data point from a real integration: `0.85` worked well for mangaFinder's manga-metadata KB — genuinely relevant hits landed under ~0.75, off-topic queries only surfaced ~0.96+ — but that's specific to their content/model, not a universal number.)

**Results are always deduplicated to one per document** — the single best (lowest-distance) matching chunk. A document with several chunks that all match a query would otherwise crowd out `topK` with repeats of itself, which was never useful (this used to be something every consumer had to re-solve client-side; now it's Homebase's job). `topK` counts *documents*, not chunks.

`score` is a raw vector distance (lower = closer/more relevant) — not a normalized similarity score. `404` if the KB doesn't exist yet.

## Embedding model override

A KB's embedding model is decided once — by whichever call is the *first* to write to that KB name — and is fixed after that, because its vector table is sized to that model's output dimension.

```bash
curl localhost:3000/kb/premium-kb/documents \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"...", "model":"mxbai-embed-large"}'
```

If a later call to the same (already-existing) KB passes a *different* `model`, it's rejected with `400` — mixing dimensions in one vector table isn't possible, and silently ignoring the override would be more confusing than an explicit error. Use a new KB name to start over with a different model. Omit `model` entirely to use the default (`nomic-embed-text`).

Verified: two KBs (`nomic-embed-text` @ 768-dim and `mxbai-embed-large` @ 1024-dim) coexisting and both searching correctly.

## Errors

| Condition | Status |
|---|---|
| Missing/empty `text` or `query`, invalid KB name | `400`, Zod issues or message |
| KB already uses a different embedding model | `400` |
| KB or document not found | `404` |
| Embedding call fails (Ollama unreachable, etc.) | `502` |
