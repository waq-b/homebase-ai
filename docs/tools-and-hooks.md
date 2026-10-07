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

`InvokeContext` exposes `{ agent: AgentConfig, input?: unknown }` — the full parsed config of the agent being invoked (so a hook can branch on `ctx.agent.name`, `ctx.agent.model`, etc.), plus the request's (possibly `beforeInvoke`-modified) input. `ctx.input` is set once in `invoke.ts`'s `prepare()`, right after `beforeInvoke` resolves — so it's available in `afterInvoke` too, even though `afterInvoke` itself only receives the model's output as its first argument.

### `beforeInvoke(input, ctx)`

Runs after input validation, before the input is turned into model messages. Return value replaces `input` for the rest of the pipeline. Can be async. A thrown error becomes a `500` (`HookError`), wrapping the original error message.

### `afterInvoke(output, ctx)`

Runs on the model's full text output, **plain (non-streaming) path only** — see `docs/invoke.md` for why streaming skips it. Return value replaces the response's `output` field.

**Pattern: deterministic backstop for a constraint the model won't reliably follow.** Small local models don't always comply with hard constraints from prompting alone, even with an explicit rule and a worked example — `examples/manga/manga-recommend.hooks.ts` is a live example: the system prompt tells the model to never output a candidate already in the user's reading list, but that alone measured 0/8 compliance on a repeatable test case. Rather than keep tuning the prompt, `afterInvoke` parses the model's JSON output (using `ctx.input` to see the original `readingList`) and deterministically strips any match — the model still does the actual ranking/scoring, the hook just guarantees the hard constraint holds regardless of what the model does. Worth reaching for whenever a constraint is easy to check in code but unreliable to enforce purely through prompting.

**Pattern: validating a JSON-output agent's shape.** Homebase itself does no schema validation or retry on an agent's raw text output (a deliberate scope decision: no genuine malformed-JSON failure has been observed, only semantic ones like the exclusion bug above, which retrying wouldn't fix anyway). If an agent's contract depends on valid JSON matching a specific shape, validate it in `afterInvoke` — parse, check against a Zod schema, throw on failure:

```ts
const outputSchema = z.array(z.object({ action: z.string(), title: z.string(), /* ... */ }));

export default {
  afterInvoke: (output: string) => {
    const parsed = outputSchema.safeParse(JSON.parse(output));
    if (!parsed.success) throw new Error(`Malformed output: ${parsed.error.message}`);
    return output;
  },
};
```

A thrown error here becomes a clean `500` (`HookError`) via the existing error-handling path — no retry at the Homebase level; the calling app decides whether/how to retry. This is what `parseAgentOutput`/`AgentOutputError` in `homebase-client` does client-side; validating in a Homebase `afterInvoke` hook is the same idea, just movable to whichever side makes sense for a given agent.

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
- **Streaming becomes simulated, not token-by-token.** Forced by `simulateStreaming: true` whenever the agent's merged tool set (`hooks.ts` tools + `mcpServers` tools) is non-empty — so an MCP-only agent with no `hooks.ts` tools of its own still simulates.
- **The model decides whether to call the tool at all.** Small local models are inconsistent — sometimes they'll answer from internal knowledge instead of calling a clearly-relevant tool. That's model behavior, not something a hook can force.

## The shared `tools/` convention

```
tools/
├── webSearch.ts      # generic DuckDuckGo-backed search — agents/researcher.yaml
└── fetchPageText.ts  # fetch a URL and return its visible text — agents/page-summarizer.yaml
```

Any agent's `hooks.ts` can import any file in `tools/` — there's no per-agent tool registration beyond the import.

`tools/webSearch.ts`: a DuckDuckGo Instant-Answer-API-backed search tool, no API key required.

```ts
export const webSearch = tool({
  description: "Searches the web via DuckDuckGo's Instant Answer API and returns a short summary.",
  parameters: z.object({ query: z.string().describe("The search query") }),
  execute: async ({ query }) => { /* ... */ },
});
```

**Known limitation:** DuckDuckGo's Instant Answer API is sparse for anything outside broad encyclopedic topics (it often returns no abstract text for niche or specific queries, and never returns a source URL) — and its HTML search endpoint (a tempting keyless alternative) hard-blocks with a 403 after a single request, so it's not a viable swap either. Fine for `researcher`'s demo purpose; **not** a good fit for anything needing real, domain-specific grounding — see `examples/manga/tools/mangaMetadataSearch.ts` for how a domain-specific agent moved off it.

**A domain-specific tool.** `examples/manga/tools/mangaMetadataSearch.ts` is a purpose-built replacement for `webSearch` for one agent. It queries three public sources (MangaDex, AniList and MangaUpdates) in order until one returns results, and normalises their different status and format vocabularies into one shape, so the agent's prompt doesn't need to know which backend answered. It is a good template for "the generic tool doesn't fit this domain, so build a purpose-built one".

**Limitation of small models.** In a multi-step tool-call loop, small local models can lose track of the original query when several verbose tool results crowd their context window. The tools return correct results when called directly; this is a limit of small models under long tool loops, consistent with the "model decides whether to use tools" caveat above.

## Adding a new tool

1. Add `tools/myTool.ts`, exporting a `tool()` definition (parameters as a Zod schema, `execute` as an async function).
2. Import it into whichever agent's `hooks.ts` needs it and add it to the `tools` map.
3. Pick a model that supports tool-calling for that agent (see above).
