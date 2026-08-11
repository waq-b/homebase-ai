# Invoking agents

Deep reference for `POST /agents/<name>/invoke` (`src/invoke.ts`). For quickstart curl examples, see the README.

## Request pipeline

Both the plain and streaming paths share the same `prepare()` step (`src/invoke.ts`):

1. **Validate** — `inputPayloadSchema(agent.input).safeParse(rawBody)`. On failure, throws `InputValidationError` → `400` with Zod issue details.
2. **`beforeInvoke`** — if the agent has a hooks file with a `beforeInvoke`, it runs on the parsed `input` value and can mutate/enrich it before the model call. Throwing here → `500` (`HookError`).
3. **Build messages** — `toMessages()` turns the (possibly hook-modified) input into a `CoreMessage[]`, prefixed with the agent's `system` message if set. See `docs/agents.md` for how each `input.type` maps to messages.
4. **Model call** — `generateText` (plain) or `streamText` (SSE), with `temperature`/`maxTokens` from `params` and `tools`/`maxSteps: 5` if the agent has hooks-declared tools. A provider/network failure here → `502` (`ProviderError`).
5. **`afterInvoke`** — plain path only (see below) — post-processes the model's text output. Throwing here → `500`.

## Plain (non-streaming)

```bash
curl localhost:3000/agents/summarizer/invoke \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"Some text to summarize."}'
```

Response: `{ "output": "..." }`. Runs `afterInvoke` (if defined) on the model's full text before responding, since the complete response is available before anything is sent to the client.

## Streaming (SSE)

```bash
curl -N "localhost:3000/agents/summarizer/invoke?stream=true" \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"Some text to summarize."}'
```

> zsh users: quote the URL when it has a `?`, or the shell will try to glob-expand it.

Each SSE frame is a JSON payload, one of:

| Frame | When |
|---|---|
| `{"delta":"..."}` | A text chunk. |
| `{"toolCall":{"name":"...","args":{...}}}` | The model invoked a tool (tool-bearing agents only). |
| `{"toolResult":{"name":"...","result":{...}}}` | The tool's return value, fed back to the model. |
| `{"done":true}` | End of stream. |
| `{"error":"..."}` | Something failed mid-stream. |

**`afterInvoke` does not run on the streaming path** — by the time tokens have already reached the client, there's nothing left to post-process. If an agent needs `afterInvoke` semantics, don't rely on it while streaming.

**Tool-bearing agents lose real token-by-token streaming** — see the `simulateStreaming` note in `docs/agents.md`. You still get an SSE stream, it's just generate-then-chunk rather than live tokens.

## Error mapping

| Condition | Status |
|---|---|
| Unknown agent name | `404` |
| Input fails the agent's declared schema | `400`, with Zod `issues` array |
| A `beforeInvoke`/`afterInvoke` hook throws | `500` |
| Model/provider call fails (network, Ollama error, etc.) | `502` |

## Tool-calling round trips

Tool-bearing agents get `maxSteps: 5` — the model can call a tool, receive its result, and continue reasoning for up to 5 round trips before the call is forced to conclude. This is fixed in `src/invoke.ts` (`MAX_TOOL_STEPS`), not currently configurable per-agent.
