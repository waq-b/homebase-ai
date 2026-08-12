# homebase-client

Shared, domain-free client for calling [Homebase](..) from a toolkit app — agent invoke (plain + SSE streaming), RAG knowledge bases, and conversation memory. Extracted from mangaFinder's `src/homebase/*` once betBuddy needed the same ~185 lines of boilerplate a second time. Lives inside the Homebase repo (this is the thing it's a client *for*) rather than its own repo, so it ships and versions alongside the API surface it wraps.

Not published — consumed via a `file:` dependency, from a sibling app repo (e.g. `toolkit/betBuddy`, `toolkit/mangaFinder`):

```json
{
  "dependencies": {
    "homebase-client": "file:../homebase/homebase-client"
  }
}
```

Then `npm install` and `npm run build` (in this package) whenever its source changes — consumers import compiled `dist/`, not `src/` directly.

## What's deliberately *not* in here

- **Mock mode.** A mock stands in for a specific agent's contract (e.g. mangaFinder's `mockInvokeAgent` for `manga-search`/`manga-recommend`/`manga-log`), which this package has no knowledge of. Apps that want a `HOMEBASE_MODE=mock` toggle branch on their own config before calling `invokeAgent` — this package's `invokeAgent` always hits the real Homebase HTTP API.
- **Per-agent output schemas.** `parseAgentOutput(agentName, raw, schema)` is generic (JSON.parse + Zod validate); the Zod schemas themselves (what a specific agent's output actually looks like) are app-specific and stay in the consuming app.

## Usage

```ts
import { createHomebaseClient, parseAgentOutput, AgentOutputError } from "homebase-client";
import { z } from "zod";

const homebase = createHomebaseClient(); // defaults to process.env.HOMEBASE_URL ?? "http://localhost:3000"

const raw = await homebase.invokeAgent("summarizer", "Some text to summarize.");
const output = parseAgentOutput("summarizer", raw, z.object({ summary: z.string() }));

const kbs = await homebase.kb.listKbs();
const results = await homebase.kb.searchKb("my-kb", "some query");

for await (const frame of homebase.invokeAgentStream("chat-agent", messages, { conversationId: "user-1" })) {
  if (frame.delta) process.stdout.write(frame.delta);
}
```
