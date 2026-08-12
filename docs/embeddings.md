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
{ "vector": [0.123, -0.045, ...], "model": "nomic-embed-text" }
```

**Batch:**

```bash
curl localhost:3000/embed \
  -X POST -H 'content-type: application/json' \
  -d '{"texts":["chunk one text...", "chunk two text...", "chunk three text..."]}'
```

```json
{ "vectors": [[0.12, ...], [0.08, ...], [0.31, ...]], "model": "nomic-embed-text" }
```

`vectors[i]` corresponds to `texts[i]` — order preserved, one vector per input string. Batch mode is a **real single HTTP call** to Ollama's `/api/embed` (which natively accepts an array of inputs), not a loop of individual embed calls — `embedTexts` in `src/embeddings.ts` via the AI SDK's `embedMany()`. Up to 2048 texts per call (`ollama-ai-provider`'s `maxEmbeddingsPerCall` default); there's no Homebase-level cap beyond that.

RAG's `addDocument`/`updateDocument` (`docs/rag.md`) use this internally to embed all of a document's chunks in one round trip, instead of one request per chunk.

- `text` / `texts` (required, exactly one): what to embed.
- `model` (optional): overrides the default embedding model for this call — applies to both modes.

## Model

Default model is `nomic-embed-text` (768-dimensional), configurable via the `EMBEDDING_MODEL` env var. Pulled locally via Ollama:

```bash
ollama pull nomic-embed-text
```

Provider mapping goes through `ollama-ai-provider`'s `.embedding(modelId)` (`src/providers.ts`, `getEmbeddingModel`); the AI SDK's `embed()`/`embedMany()` functions do the actual call (`src/embeddings.ts`).

**Note on RAG use:** each knowledge base (`/kb/*`) gets its own dedicated vector table, sized to whichever model *first* wrote to that KB — see `docs/rag.md`'s "Embedding model override" section. There's no single fixed dimension across all KBs; `/embed` used standalone has no dimension constraint at all, any model works.

## Errors

| Condition | Status |
|---|---|
| Missing both `text` and `texts`, or both given, or empty string(s) | `400`, Zod issues |
| Ollama unreachable or model not pulled | `502` |
