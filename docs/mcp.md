# MCP client support

Deep reference for declaring external MCP servers on an agent (`src/mcp.ts`), added in v2.4. Homebase acts as an MCP **client** — agents can use tools from external MCP servers via config, instead of every tool needing hand-written code in `hooks.ts`. Fully independent of v2.1–v2.3, and additive: existing `hooks.ts`-only tool agents are completely unaffected.

## Declaring an MCP server

```yaml
# agents/my-agent.yaml
name: my-agent
...
mcpServers:
  - name: some-server
    url: http://localhost:8787/sse
```

`mcpServers` is a new optional top-level field in `AgentConfig` (`src/config.ts`) — a list of `{ name, url }`. Multiple servers can be declared; their tools are merged together, and merged again with any `hooks.ts` tools the agent defines. Name clashes between an MCP tool and a `hooks.ts` tool aren't resolved specially — whichever ends up later in the merge (`{ ...hooks.tools, ...mcp.tools }`, so MCP wins) takes effect. Avoid overlapping tool names in practice.

Only the `sse` MCP transport is supported (the AI SDK's built-in `experimental_createMCPClient` transport type) — a server must be reachable over HTTP/SSE, not stdio.

## How it works

`connectMcpServers()` (`src/mcp.ts`) connects to every declared server **at invoke time** — per request, matching the rest of Homebase's re-read-everything-per-request model (same philosophy as the YAML registry). Connections are closed again once the model call finishes (`mcpClose()` in `src/invoke.ts`, called after `generateText` resolves on the plain path, or in a `finally` around stream consumption on the streaming path — guaranteed exactly once even if the stream errors or the client disconnects before finishing).

**If any declared server fails to connect**, the whole invoke fails with a `502` (`McpConnectionError`, naming which server) rather than silently dropping that server's tools — any *other* servers in the same `mcpServers` list that *did* connect successfully are still closed before the error propagates, so a partial failure doesn't leak those connections. If `beforeInvoke` throws after MCP servers already connected, those connections are also closed before the error surfaces.

This means: no persistent connection pool, and a fresh MCP round trip on every single invoke. Fine for v1 given MCP is the lowest-priority/least-urgent piece of the v2 epic — revisit (e.g. connection pooling keyed by server URL) if latency becomes a real problem for an MCP-tool-heavy agent.

## Proof of concept

`mcp-servers/demo-time/server.ts` is a small, self-contained, keyless MCP server (built with `@modelcontextprotocol/sdk`, SSE transport) exposing two tools: `getCurrentTime` and `rollDice`. It's a genuinely separate process from Homebase, connected to over the network — not baked into `hooks.ts` — which is what actually proves the MCP client path works end to end.

```bash
npm run mcp:demo
# MCP demo server (time/dice) listening on http://localhost:8787/sse
```

`agents/mcp-demo.yaml` uses it:

```bash
curl localhost:3000/agents/mcp-demo/invoke \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"What time is it right now on the server?"}'
```

Verified working for both the plain and streaming paths (tool-call/tool-result SSE frames included).

## Using a real external MCP server instead

Swap `mcp-demo.yaml`'s `mcpServers` entry for any real SSE-hosted MCP server's `{ name, url }` — no code changes needed, this is purely config. If the server needs auth, the transport config also accepts `headers` (see `MCPTransportConfig` in the AI SDK's types) — not yet exposed in Homebase's `mcpServers` YAML shape (only `name`/`url` today); extend `src/config.ts`'s `mcpServers` schema and `src/mcp.ts`'s `connectMcpServers` if/when an agent needs one that requires credentials.

**Update:** `manga-search`'s web-search grounding did get fixed, but not via MCP — see `docs/tools-and-hooks.md`'s `tools/mangaMetadataSearch.ts` section. It moved to a purpose-built keyless tool (MangaDex + AniList) called directly from `hooks.ts`, not through an MCP server. Swapping to an MCP-based search provider (e.g. Brave Search, Tavily) is still a real option if a better result set is ever needed — that still requires a real server URL and, realistically, an API key, both things only you can supply — the `mcpServers` config shape above is exactly what that would look like on `agents/manga-search.yaml`.
