# Tools and hooks

Deep reference for `agents/<name>.hooks.ts` and the shared `tools/` convention (`src/hooks.ts`). For a quick working example, see the README's "Optional hooks" / "Tools" sections.

## The hooks module contract

```ts
// agents/my-agent.hooks.ts
export default {
  beforeInvoke: (input: unknown, ctx: InvokeContext) => input,
  afterInvoke: (output: string, ctx: InvokeContext) => output,
  tools: { /* AI SDK tool() definitions */ },
};
```

All three keys are optional (`AgentHooks` in `src/hooks.ts`) — an agent with no `hooks:` field in its YAML, or a hooks file exporting `{}`, works fine; missing hooks are treated as pass-through no-ops.

`loadHooks()` dynamically `import()`s the file referenced by the agent's `hooks:` path (relative to the YAML file, resolved against `AGENTS_DIR`) on every invoke — same re-read-per-request model as the YAML registry.

`InvokeContext` currently exposes just `{ agent: AgentConfig }` — the full parsed config of the agent being invoked, so a hook can branch on `ctx.agent.name`, `ctx.agent.model`, etc.

### `beforeInvoke(input, ctx)`

Runs after input validation, before the input is turned into model messages. Return value replaces `input` for the rest of the pipeline. Can be async. A thrown error becomes a `500` (`HookError`), wrapping the original error message.

### `afterInvoke(output, ctx)`

Runs on the model's full text output, **plain (non-streaming) path only** — see `docs/invoke.md` for why streaming skips it. Return value replaces the response's `output` field.

### `tools`

A `ToolSet` (AI SDK's `tool()` map) — real LLM-driven tool-calling, not something a hook invokes manually. The model itself decides whether and when to call a tool, based on its `description` and the conversation so far, up to `MAX_TOOL_STEPS` (5) round trips.

```ts
import { webSearch } from "../tools/webSearch.js";

export default {
  tools: { webSearch },
};
```

Two behavioral consequences of declaring `tools`, both driven from `src/providers.ts`/`src/invoke.ts`:

- **Not every Ollama model supports tool-calling.** Sending `tools` to a model that doesn't (e.g. plain `llama3:latest`) 400s. Pick a model with real tool support (`qwen2.5`, `llama3.1`+, `mistral-nemo`, etc.) — see `agents/shout.yaml` for a tool-less agent and `agents/researcher.yaml` for a tool-bearing one.
- **Streaming becomes simulated, not token-by-token.** Forced by `simulateStreaming: true` whenever `hooks.tools` is non-empty.
- **The model decides whether to call the tool at all.** Small local models are inconsistent — sometimes they'll answer from internal knowledge instead of calling a clearly-relevant tool. That's model behavior, not something a hook can force.

## The shared `tools/` convention

```
tools/
└── webSearch.ts   # one file per tool, each exporting an AI SDK tool() definition
```

Any agent's `hooks.ts` can import any file in `tools/` — there's no per-agent tool registration beyond the import. `tools/webSearch.ts` is the reference example: a DuckDuckGo Instant-Answer-API-backed search tool, no API key required.

```ts
export const webSearch = tool({
  description: "Searches the web via DuckDuckGo's Instant Answer API and returns a short summary.",
  parameters: z.object({ query: z.string().describe("The search query") }),
  execute: async ({ query }) => { /* ... */ },
});
```

**Known limitation:** DuckDuckGo's Instant Answer API is sparse for anything outside broad encyclopedic topics (it often returns no abstract text for niche or specific queries, and never returns a source URL). Agents relying on it for grounding — e.g. `manga-search` — will correctly return empty/no-results rather than hallucinate when the API comes back empty, but real-world result quality is capped by this backend. Worth revisiting with a stronger search tool if grounding quality becomes a blocker for a given agent.

## Adding a new tool

1. Add `tools/myTool.ts`, exporting a `tool()` definition (parameters as a Zod schema, `execute` as an async function).
2. Import it into whichever agent's `hooks.ts` needs it and add it to the `tools` map.
3. Pick a model that supports tool-calling for that agent (see above).
