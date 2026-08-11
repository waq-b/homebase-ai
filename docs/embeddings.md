# Embeddings

Deep reference for `POST /embed` (`src/embeddings.ts`), added in v2.1.

## What it's for

Turns text into a vector. Same shape as `/agents/*/invoke` (compute in, result out) — **no storage, no state**. It's the foundation RAG (`docs/rag.md`) builds on for chunk/query embedding, but it's also directly callable on its own.

## Request

```bash
curl localhost:3000/embed \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"Solo Leveling is a manhwa about a weak hunter who becomes the strongest."}'
```

```json
{ "text": "...", "model": "optional-override" }
```

- `text` (required): the string to embed.
- `model` (optional): overrides the default embedding model for this call.

## Response

```json
{ "vector": [0.123, -0.045, ...], "model": "nomic-embed-text" }
```

## Model

Default model is `nomic-embed-text` (768-dimensional), configurable via the `EMBEDDING_MODEL` env var. Pulled locally via Ollama:

```bash
ollama pull nomic-embed-text
```

Provider mapping goes through `ollama-ai-provider`'s `.embedding(modelId)` (`src/providers.ts`, `getEmbeddingModel`), the AI SDK's `embed()` function does the call (`src/embeddings.ts`).

**Note:** if you override `model` to something other than `nomic-embed-text` for RAG use (`/kb/*`), make sure its output dimension matches `EMBEDDING_DIM` (768) in `src/db.ts` — the `kb_vectors` table's vector column is a fixed-width `float[768]`. Mismatched dimensions will fail at insert/search time. `/embed` used standalone has no such constraint — any model works.

## Errors

| Condition | Status |
|---|---|
| Missing/empty `text` | `400`, Zod issues |
| Ollama unreachable or model not pulled | `502` |
