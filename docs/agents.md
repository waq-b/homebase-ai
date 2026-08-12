# Agents

Deep reference for `agents/*.yaml` and the `AgentConfig` schema (`src/config.ts`). For the quickest path to adding an agent, see the README's "Adding an agent" section — this page covers the full schema and edge cases.

## File layout

```
agents/
├── my-agent.yaml         # required — config, validated against agentConfigSchema
└── my-agent.hooks.ts     # optional — beforeInvoke/afterInvoke/tools
```

The registry (`src/registry.ts`) re-reads every `agents/*.yaml` file on every request — no caching, no server restart needed to add/edit an agent.

**A malformed YAML file is isolated to itself** — it's skipped (logged server-side as `Skipping invalid agent config: ...`) rather than aborting the whole registry load, so one broken agent doesn't take `GET /agents`, `GET /openapi.json`/`/docs`, or any *other* agent's `/invoke` down with it. Invoking the broken agent by its own name (matched by the `agents/<name>.yaml` filename convention) returns a `500` with the real Zod validation details; invoking any other agent, or listing agents, works normally. A broken `*.hooks.ts` file behaves the same way at invoke time — only that agent's calls fail, as a `500` (`HookError`), everything else is unaffected.

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Must be non-empty. Used as the route segment: `/agents/<name>/invoke`. |
| `description` | string | yes | Shown in `GET /agents` and as the OpenAPI operation summary. |
| `provider` | `"ollama"` | yes | Only provider in v1. |
| `model` | string | yes | Passed straight through to the provider, e.g. `qwen2.5:14b`. |
| `system` | string | no | System prompt, prepended as a `system` message. |
| `input` | object | yes | See "Input types" below. |
| `params.temperature` | number | no | Forwarded to the AI SDK call. |
| `params.maxTokens` | number | no | Forwarded to the AI SDK call. |
| `hooks` | string | no | Relative path (from the YAML file) to a `.hooks.ts` module. |
| `mcpServers` | `{ name, url }[]` | no | External MCP servers whose tools merge with `hooks.ts` tools. See `docs/mcp.md`. |

## Input types

`input.type` is one of `string`, `messages`, or `object`. This determines both the Zod schema used to validate `POST /agents/<name>/invoke` request bodies and how the input gets turned into model messages (`toMessages` in `src/invoke.ts`).

### `string`

```yaml
input:
  type: string
```

Request body: `{ "input": "some text" }`. Becomes a single `user` message with that text as content.

### `messages`

```yaml
input:
  type: messages
```

Request body: `{ "input": [{ "role": "user" | "system" | "assistant", "content": "..." }, ...] }`. The array is passed straight through as the conversation's message list (after the agent's own `system` message, if set).

### `object`

```yaml
input:
  type: object
  shape:
    query: string
    limit: number
```

Request body: `{ "input": { "query": "...", "limit": 5 } }`. The whole `input` object is `JSON.stringify`'d into a single `user` message — the model receives it as JSON text, not as structured tool input. Validation happens against the declared `shape`, so malformed payloads 400 with field-level Zod details before the model is ever called.

#### Shape fields: shorthand vs. full spec

Each entry in `shape` is a `FieldSpec`, either:

- **Shorthand** — a bare scalar: `query: string` (equivalent to `{ type: "string" }`). Works for `string` / `number` / `boolean` only.
- **Full spec** — `{ type: ..., nullable?: boolean }`, needed for `array`, `object`, or `nullable` fields:

```yaml
shape:
  tags:
    type: array
    items: string          # items is itself a FieldSpec — can nest arbitrarily deep
  rating:
    type: number
    nullable: true          # allows null in addition to number
  preferences:
    type: object
    shape:
      favoriteGenres:
        type: array
        items: string
      notes:
        type: string
        nullable: true
```

`FieldSpec` is recursive (`z.lazy` in `src/config.ts`) — `array`/`object` fields nest without depth limit. All fields are required unless marked `nullable` (there's no separate `optional`; a field is either present-and-typed, or present-and-`type | null`).

See `agents/manga-search.yaml` for a flat example and `agents/manga-recommend.yaml` for a fully nested one.

## Provider mapping

`src/providers.ts` maps `{ provider, model }` to an AI SDK `LanguageModel`. For `ollama`, this goes through `ollama-ai-provider` against `OLLAMA_BASE_URL` (default `http://localhost:11434/api`).

Agents whose `hooks.tools` is non-empty get `simulateStreaming: true` forced on — Ollama's in-stream tool-call detection is unreliable in practice, so tool-bearing agents generate the full response then chunk it for SSE, rather than streaming raw tokens. Tool-less agents stream real tokens.

## OpenAPI generation

`src/openapi.ts` builds a fresh OpenAPI 3.1 document from the live registry on every request to `/docs` and `/openapi.json`. Each agent's request body schema comes straight from `inputPayloadSchema(agent.input)` via `zod-to-json-schema` — nested `object` shapes, `nullable` fields, and arrays all render correctly with no special-casing needed in `openapi.ts` itself.
