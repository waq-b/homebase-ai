# Homebase

A local "mini-Bedrock": a single gateway that hosts and serves AI agents as HTTP endpoints. Every other app in the AI Toolkit calls Homebase for its AI needs instead of talking to a model provider directly.

Full spec: [`HOMEBASE_BRIEF.md`](./HOMEBASE_BRIEF.md). Project conventions: [`claude.md`](./claude.md).

## Quickstart

Requires a local [Ollama](https://ollama.com) server with at least one model pulled (e.g. `ollama pull llama3`).

```bash
npm install
npm run dev
```

This starts the server at `http://localhost:3000`. Confirm it's up:

```bash
curl localhost:3000/health
# {"status":"ok"}
```

Browse the interactive docs at [`http://localhost:3000/docs`](http://localhost:3000/docs) (Scalar UI, generated live from the registered agents).

## Adding an agent

Drop a new YAML file into `agents/` — no server restart or code change needed, the registry re-reads `agents/*.yaml` on every request.

```yaml
# agents/my-agent.yaml
name: my-agent
description: What this agent does
provider: ollama
model: llama3:latest
system: |
  You are a helpful assistant.
input:
  type: string        # string | messages | object (with a `shape` map)
params:
  temperature: 0.3
  maxTokens: 1000
hooks: ./my-agent.hooks.ts   # optional
```

It appears immediately in `GET /agents` and `GET /docs`.

### Optional hooks

Add `agents/my-agent.hooks.ts` beside the YAML to hook into the invoke pipeline:

```ts
export default {
  beforeInvoke: (input, ctx) => input,   // mutate/enrich input before the model call
  afterInvoke: (output, ctx) => output,  // post-process model output (non-streaming only)
  tools: { /* AI SDK tool() definitions, see tools/ */ },
};
```

All three are optional — agents with no hooks file work fine. See `agents/shout.yaml` / `agents/shout.hooks.ts` for a before/after-hooks example.

### Tools

`tools` are real AI SDK `tool()` definitions — the model itself decides whether and when to call them (up to a 5-step round-trip), not something a hook invokes manually. Live example: `agents/researcher.yaml` / `agents/researcher.hooks.ts`, which exposes `tools/webSearch.ts` (a DuckDuckGo-backed search tool, no API key needed).

```bash
curl localhost:3000/agents/researcher/invoke \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"What is the Eiffel Tower?"}'
```

Two things worth knowing before you add tools to your own agent:
- **Not every model supports Ollama's tool-calling template.** `shout` deliberately has no tools — it runs on `llama3:latest`, which 400s if you send a `tools` field. Pick a model with real tool support (`qwen2.5`, `llama3.1`+, `mistral-nemo`, etc.).
- **Tool-bearing agents lose real token-by-token streaming.** `ollama-ai-provider`'s in-stream tool-call detection is unreliable in practice (confirmed: the tool silently never fired and the model emitted garbage tokens). Homebase works around this by forcing `simulateStreaming` for any agent with tools — you still get an SSE stream, it's just generate-then-chunk instead of live tokens. Tool-less agents are unaffected and stream normally.
- **The model decides whether to call the tool at all.** Small local models are inconsistent about this — sometimes they'll answer from their own knowledge instead of calling a tool that's clearly relevant. That's model behavior, not a Homebase bug.

## Invoking an agent

**Plain (non-streaming):**

```bash
curl localhost:3000/agents/summarizer/invoke \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"Some text to summarize."}'
```

**Streaming (SSE):**

```bash
curl -N "localhost:3000/agents/summarizer/invoke?stream=true" \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"Some text to summarize."}'
```

> zsh users: quote the URL when it has a `?` in it, or the shell will try to glob-expand it.

Streamed frames are JSON, one of:
- `{"delta":"..."}` — a text chunk
- `{"toolCall":{"name":"...","args":{...}}}` — the model invoking a tool (tool-bearing agents only)
- `{"toolResult":{"name":"...","result":{...}}}` — the tool's return value fed back to the model
- `{"done":true}` — end of stream
- `{"error":"..."}` — something failed mid-stream

`afterInvoke` only runs on the plain (non-streaming) path — by the time streamed tokens reach the client, there's nothing left to post-process.

**Errors:** unknown agent → `404`, invalid input (per the agent's declared `input.type`) → `400` with Zod details, a hook that throws → `500`, model/provider failure → `502`.

## Project layout

```
src/
├── server.ts      # Hono app, routes, error mapping
├── registry.ts     # reads + validates agents/*.yaml per request
├── config.ts       # Zod schemas: agent config + per-agent input payload
├── providers.ts     # maps agent config to an AI SDK model instance
├── invoke.ts        # validate input -> beforeInvoke -> model call -> afterInvoke
├── hooks.ts         # loads/executes optional <name>.hooks.ts
└── openapi.ts        # builds the OpenAPI 3.1 doc from the live registry
agents/               # <name>.yaml (+ optional <name>.hooks.ts)
tools/                # shared AI SDK tool() definitions, importable from any hooks.ts
```

## Scripts

```bash
npm run dev        # start with auto-reload
npm run typecheck  # tsc --noEmit
npm run build       # compile to dist/
```
