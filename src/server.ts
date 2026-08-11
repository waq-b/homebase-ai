import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { Scalar } from "@scalar/hono-api-reference";
import { z } from "zod";
import { AgentConfigError, getAgent, loadAgents } from "./registry.js";
import { HookError } from "./hooks.js";
import { InputValidationError, ProviderError, invokeAgent, invokeAgentStream } from "./invoke.js";
import { buildOpenApiSpec } from "./openapi.js";
import { embedText } from "./embeddings.js";
import { addDocument, searchKb } from "./rag.js";
import { clearConversation, getConversationTurns } from "./memory.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/agents", async (c) => {
  try {
    const agents = await loadAgents();
    return c.json(
      agents.map((agent) => ({
        name: agent.name,
        description: agent.description,
        input: agent.input.type,
      })),
    );
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return c.json({ error: err.message }, 500);
    }
    throw err;
  }
});

app.get("/openapi.json", async (c) => {
  const agents = await loadAgents();
  return c.json(buildOpenApiSpec(agents));
});

app.get("/docs", Scalar({ url: "/openapi.json" }));

const readJsonBody = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
};

const badJson = (c: Context) => c.json({ error: "Request body must be valid JSON" }, 400);

const mapInvokeError = (c: Context, err: unknown) => {
  if (err instanceof InputValidationError) {
    return c.json({ error: "Invalid input", issues: err.issues }, 400);
  }
  if (err instanceof HookError) {
    return c.json({ error: err.message }, 500);
  }
  if (err instanceof ProviderError) {
    return c.json({ error: err.message }, 502);
  }
  throw err;
};

app.post("/agents/:name/invoke", async (c) => {
  const agent = await getAgent(c.req.param("name"));
  if (!agent) {
    return c.json({ error: `Unknown agent: ${c.req.param("name")}` }, 404);
  }

  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);
  const body = parsedBody.body;

  if (c.req.query("stream") !== "true") {
    try {
      const output = await invokeAgent(agent, body);
      return c.json({ output });
    } catch (err) {
      return mapInvokeError(c, err);
    }
  }

  let result: Awaited<ReturnType<typeof invokeAgentStream>>;
  try {
    result = await invokeAgentStream(agent, body);
  } catch (err) {
    return mapInvokeError(c, err);
  }

  return streamSSE(c, async (sse) => {
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          await sse.writeSSE({ data: JSON.stringify({ delta: part.textDelta }) });
        } else if (part.type === "tool-call") {
          await sse.writeSSE({
            data: JSON.stringify({ toolCall: { name: part.toolName, args: part.args } }),
          });
        } else if ((part.type as string) === "tool-result") {
          // ToolSet's execute is optional at the type level, so TS can't prove a
          // result always exists here even though our tools always define one.
          const { toolName, result } = part as unknown as { toolName: string; result: unknown };
          await sse.writeSSE({ data: JSON.stringify({ toolResult: { name: toolName, result } }) });
        } else if (part.type === "error") {
          await sse.writeSSE({
            data: JSON.stringify({
              error: part.error instanceof Error ? part.error.message : String(part.error),
            }),
          });
        }
      }
      await sse.writeSSE({ data: JSON.stringify({ done: true }) });
    } catch (err) {
      await sse.writeSSE({
        data: JSON.stringify({ error: err instanceof Error ? err.message : "Stream failed" }),
      });
    }
  });
});

// v2.1 — pure compute, no storage. RAG (below) owns embedding + storage together.
app.post("/embed", async (c) => {
  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = z.object({ text: z.string().min(1), model: z.string().optional() }).safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    return c.json(await embedText(parsed.data.text, parsed.data.model));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Embedding failed" }, 502);
  }
});

// v2.2 — Homebase-hosted RAG: named knowledge bases, chunk+embed on ingest, similarity search on query.
app.post("/kb/:name/documents", async (c) => {
  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = z.object({ text: z.string().min(1) }).safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    return c.json(await addDocument(c.req.param("name"), parsed.data.text));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Embedding failed" }, 502);
  }
});

app.post("/kb/:name/search", async (c) => {
  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = z
    .object({ query: z.string().min(1), topK: z.number().int().positive().optional() })
    .safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    const results = await searchKb(c.req.param("name"), parsed.data.query, parsed.data.topK);
    return c.json({ results });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Search failed" }, 502);
  }
});

// v2.3 — conversation memory. Writing happens inside invokeAgent/invokeAgentStream
// (POST /agents/:name/invoke with a conversationId in the body); these two
// routes are just raw read/clear for app-side display or debugging.
app.get("/memory/:conversationId", (c) => {
  const conversationId = c.req.param("conversationId");
  return c.json({ conversationId, turns: getConversationTurns(conversationId) });
});

app.delete("/memory/:conversationId", (c) => {
  return c.json({ cleared: clearConversation(c.req.param("conversationId")) });
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Homebase listening on http://localhost:${info.port}`);
});
