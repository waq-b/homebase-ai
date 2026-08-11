# RAG (knowledge bases)

Deep reference for `POST /kb/:name/documents` and `POST /kb/:name/search` (`src/rag.ts`), added in v2.2. Depends on the embedding endpoint (`docs/embeddings.md`) for vectorization.

## What it's for

Homebase-hosted retrieval: apps create named knowledge bases (e.g. `"manga-kb"`, `"homebase-docs-kb"`), push documents in, and query by similarity search. KBs are namespaced by name — no cross-KB search in v1.

## Storage

SQLite (via Node's built-in `node:sqlite`, no native dependency) + the [`sqlite-vec`](https://github.com/asg017/sqlite-vec) extension for vector search, in `data/homebase.db` (created on first use, gitignored). Kept deliberately "boring" per project convention — no heavyweight vector DB.

Two tables (`src/db.ts`):
- `kb_chunks` — `(id, kb_name, chunk_index, content, created_at)`, one row per chunk
- `kb_vectors` — a `vec0` virtual table, `rowid` matching `kb_chunks.id`, `embedding float[768]`

## Add a document

```bash
curl localhost:3000/kb/manga-kb/documents \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"Solo Leveling is a manhwa about...\n\nVagabond is a manga about..."}'
```

```json
{ "chunksAdded": 2 }
```

The whole document is chunked and each chunk is embedded and stored automatically — no separate embed step needed on the caller's side.

### Chunking

Fixed-size, paragraph-aware (`chunkText` in `src/rag.ts`): splits on blank lines first, then further splits any paragraph over 800 characters into fixed 800-char pieces. Deliberately simple for v1 — no semantic chunking, no overlap between chunks. Revisit if retrieval quality demands it.

### Append-only

No update/delete-document endpoint in v1 (an open question the ticket left for build time — resolved as: append-only is fine for now, matching the ticket's own suggestion). To "replace" a document, add a new one; stale chunks aren't automatically cleaned up.

## Search

```bash
curl localhost:3000/kb/manga-kb/search \
  -X POST -H 'content-type: application/json' \
  -d '{"query":"strongest hunter leveling system","topK":5}'
```

```json
{ "results": [{ "content": "...", "score": 0.74, "chunkIndex": 0 }, ...] }
```

- `query` (required)
- `topK` (optional, default 5)

`score` is a raw vector distance (lower = closer/more relevant) — not a normalized similarity score.

### KB isolation, and its current implementation cost

`kb_vectors` is one global `vec0` table shared by every KB — this sqlite-vec version doesn't have first-class per-KB partitioning. A search asks for `max(topK * 20, 50)` nearest neighbors across *all* KBs, then filters down to the requested `kb_name` in application code and slices to `topK`. Isolation (a search never returns another KB's content) is correct today; it's just not the most efficient shape. Fine at v1 scale — revisit (a partition key, or a separate `vec0` table per KB) if a small KB ever gets crowded out by a much larger one sharing the same vector space.

## Errors

| Condition | Status |
|---|---|
| Missing/empty `text` or `query` | `400`, Zod issues |
| Embedding call fails (Ollama unreachable, etc.) | `502` |

## Validated with

A real local test KB (see the v2.2 ticket) — added a short multi-paragraph document, queried it, confirmed the semantically relevant chunk ranked first.
