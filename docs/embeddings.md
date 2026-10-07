# Embeddings

Deep reference for `POST /embed` (`src/embeddings.ts`), added in v2.1, extended with batch support shortly after.

## What it's for

Turns text into a vector — or a batch of texts into vectors, in one call. Same shape as `/agents/*/invoke` (compute in, result out) — **no storage, no state**. It's the foundation RAG (`docs/rag.md`) builds on for chunk/query embedding, but it's also directly callable on its own.

## Request

Provide exactly one of `text` (single) or `texts` (batch) — both together, or neither, is a `400`.

**Single:**

```bash
curl localhost:3000/embed \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"Solo Leveling is a manhwa about a weak hunter who becomes the strongest."}'
```

```json
{ "vector": [0.123, -0.045, ...], "model": "voyage-4-lite" }
```

**Batch:**

```bash
curl localhost:3000/embed \
  -X POST -H 'content-type: application/json' \
  -d '{"texts":["chunk one text...", "chunk two text...", "chunk three text..."]}'
```

```json
{ "vectors": [[0.12, ...], [0.08, ...], [0.31, ...]], "model": "voyage-4-lite" }
```

`vectors[i]` corresponds to `texts[i]` — order preserved, one vector per input string. Batch mode is a **real single HTTP call** to Voyage's `/v1/embeddings` (which natively accepts an array of inputs), not a loop of individual embed calls — `embedTexts` in `src/embeddings.ts` via the AI SDK's `embedMany()`. Up to 1,000 texts per call (Voyage's per-request max, set as `maxEmbeddingsPerCall` on the hand-rolled model in `src/providers.ts` — see "Model" below); there's no Homebase-level cap beyond that.

RAG's `addDocument`/`updateDocument` (`docs/rag.md`) use this internally to embed all of a document's chunks in one round trip, instead of one request per chunk.

- `text` / `texts` (required, exactly one): what to embed.
- `model` (optional): overrides the default embedding model for this call — applies to both modes.

## Model

Default model is `voyage-4-lite` (1024-dimensional by default; Voyage supports requesting 2048/1024/512/256 via `output_dimension`, not currently exposed through Homebase), configurable via the `EMBEDDING_MODEL` env var. Requires `VOYAGE_API_KEY` (get one at [dash.voyageai.com](https://dash.voyageai.com) — 200M free tokens, one-time grant, then $0.02-0.12/M depending on model tier).

**Not routed through Ollama** — Ollama Cloud (the default `provider: ollama` chat backend) doesn't serve embedding models at all (a live call to its `/api/embed` returned `401` when I tried). There's also no official AI-SDK provider package usable here: `@ai-sdk/voyage` depends on `@ai-sdk/provider@4.x`, incompatible with this project's `ai@4.3.19` (`@ai-sdk/provider@1.x`). So `getEmbeddingModel` (`src/providers.ts`) is a small hand-rolled `EmbeddingModelV1<string>` implementation calling Voyage's plain REST API (`https://api.voyageai.com/v1/embeddings`) directly — the AI SDK's `embed()`/`embedMany()` functions call it exactly like any other provider (`src/embeddings.ts`), no special-casing needed there.

**Note on RAG use:** each knowledge base (`/kb/*`) gets its own dedicated vector table, sized to whichever model *first* wrote to that KB — see `docs/rag.md`'s "Embedding model override" section. There's no single fixed dimension across all KBs; `/embed` used standalone has no dimension constraint at all, any model works.

## Errors

| Condition | Status |
|---|---|
| Missing both `text` and `texts`, or both given, or empty string(s) | `400`, Zod issues |
| Voyage unreachable, `VOYAGE_API_KEY` unset, or bad model id | `502` |
