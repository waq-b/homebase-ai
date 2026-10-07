import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { Scalar } from "@scalar/hono-api-reference";
import { z } from "zod";
import { loadAgents, loadAgentsDetailed } from "./registry.js";
import { HookError } from "./hooks.js";
import { InputValidationError, ProviderError, invokeAgent, invokeAgentStream } from "./invoke.js";
import { McpConnectionError } from "./mcp.js";
import { buildOpenApiSpec } from "./openapi.js";
import { embedText, embedTexts } from "./embeddings.js";
import {
  addDocument,
  deleteDocument,
  deleteKb,
  DocumentNotFoundError,
  EmptyDocumentError,
  getDocument,
  KbModelMismatchError,
  KbNameCollisionError,
  KbNotFoundError,
  listDocuments,
  listKbs,
  searchKb,
  updateDocument,
} from "./rag.js";
import { InvalidKbNameError } from "./db.js";
import { clearConversation, getConversationTurns, listConversations } from "./memory.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

// Bare root has nothing of its own — send visitors somewhere useful.
app.get("/", (c) => c.redirect("/dashboard"));

// Bearer-token auth: only enforced when HOMEBASE_API_KEY is set, so local
// dev (no env var) stays open while a shared/remote setup requires the header.
// /health, "/" (just a redirect, no data), and the dashboard's static shell
// (HTML/JS/CSS, no data in them) are exempt — the dashboard prompts for the
// key client-side and attaches it to its own API calls, which stay gated
// normally. Without this exemption, setting the key would 401 the page
// you'd need to enter it on.
const apiKey = process.env.HOMEBASE_API_KEY;
if (apiKey) {
  app.use("*", async (c, next) => {
    if (
      c.req.path === "/health" ||
      c.req.path === "/" ||
      c.req.path === "/dashboard" ||
      c.req.path.startsWith("/dashboard/")
    ) {
      return next();
    }
    const header = c.req.header("Authorization");
    if (header !== `Bearer ${apiKey}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });
}

// loadAgents() skips (and logs) any agent whose YAML fails validation rather
// than throwing — so these two routes can't be taken down by one broken
// config; the broken agent just doesn't appear.
app.get("/agents", async (c) => {
  const agents = await loadAgents();
  return c.json(
    agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      input: agent.input.type,
    })),
  );
});

app.get("/openapi.json", async (c) => {
  const agents = await loadAgents();
  return c.json(buildOpenApiSpec(agents));
});

app.get("/docs", Scalar({ url: "/openapi.json" }));

// v2.5 — Homebase-hosted dashboard (public/dashboard/), a static vanilla-JS
// app built from a design mockup against the real API. No second server, no build step — served straight off disk.
app.get("/dashboard", (c) => c.redirect("/dashboard/"));
app.use("/dashboard/*", serveStatic({ root: "./public" }));

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
  if (err instanceof McpConnectionError) {
    return c.json({ error: err.message }, 502);
  }
  throw err;
};

app.post("/agents/:name/invoke", async (c) => {
  const name = c.req.param("name");
  const { agents, errors } = await loadAgentsDetailed();
  const agent = agents.find((a) => a.name === name);

  if (!agent) {
    // Give a real answer instead of a misleading 404 when the requested
    // agent exists but its own YAML is what's broken (matched by Homebase's
    // agents/<name>.yaml filename convention).
    const ownError = errors.find((e) => e.file.replace(/\.ya?ml$/, "") === name);
    if (ownError) {
      return c.json({ error: ownError.message }, 500);
    }
    return c.json({ error: `Unknown agent: ${name}` }, 404);
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

  let invoked: Awaited<ReturnType<typeof invokeAgentStream>>;
  try {
    invoked = await invokeAgentStream(agent, body);
  } catch (err) {
    return mapInvokeError(c, err);
  }
  const { result, mcpClose } = invoked;

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
    } finally {
      // Guaranteed exactly once here regardless of success/error/early
      // client disconnect — the stream loop above has always exited by the
      // time we reach this, so no in-flight tool call gets cut off.
      await mcpClose();
    }
  });
});

// v2.1 — pure compute, no storage. RAG (below) owns embedding + storage together.
const embedBodySchema = z
  .object({
    text: z.string().min(1).optional(),
    texts: z.array(z.string().min(1)).min(1).max(2048).optional(),
    model: z.string().optional(),
  })
  .refine((v) => (v.text !== undefined) !== (v.texts !== undefined), {
    message: "Provide exactly one of text or texts",
  });

app.post("/embed", async (c) => {
  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = embedBodySchema.safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    if (parsed.data.text !== undefined) {
      return c.json(await embedText(parsed.data.text, parsed.data.model));
    }
    return c.json(await embedTexts(parsed.data.texts!, parsed.data.model));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Embedding failed" }, 502);
  }
});

// v2.2 — Homebase-hosted RAG: named knowledge bases, chunk+embed on ingest, similarity search on query.
const mapRagError = (c: Context, err: unknown, fallbackMessage: string) => {
  if (err instanceof KbNotFoundError || err instanceof DocumentNotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  if (
    err instanceof KbModelMismatchError ||
    err instanceof InvalidKbNameError ||
    err instanceof KbNameCollisionError ||
    err instanceof EmptyDocumentError
  ) {
    return c.json({ error: err.message }, 400);
  }
  return c.json({ error: err instanceof Error ? err.message : fallbackMessage }, 502);
};

app.get("/kb", (c) => {
  return c.json({ kbs: listKbs() });
});

app.delete("/kb/:name", (c) => {
  try {
    deleteKb(c.req.param("name"));
    return c.json({ deleted: true });
  } catch (err) {
    return mapRagError(c, err, "Delete failed");
  }
});

app.post("/kb/:name/documents", async (c) => {
  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = z
    .object({ text: z.string().min(1), metadata: z.unknown().optional(), model: z.string().optional() })
    .safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    const result = await addDocument(c.req.param("name"), parsed.data.text, {
      metadata: parsed.data.metadata,
      model: parsed.data.model,
    });
    return c.json(result);
  } catch (err) {
    return mapRagError(c, err, "Embedding failed");
  }
});

const listDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

app.get("/kb/:name/documents", (c) => {
  const parsed = listDocumentsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    return c.json(listDocuments(c.req.param("name"), parsed.data));
  } catch (err) {
    return mapRagError(c, err, "List failed");
  }
});

app.get("/kb/:name/documents/:documentId", (c) => {
  const documentId = Number(c.req.param("documentId"));
  if (!Number.isInteger(documentId)) {
    return c.json({ error: "documentId must be an integer" }, 400);
  }

  try {
    return c.json(getDocument(c.req.param("name"), documentId));
  } catch (err) {
    return mapRagError(c, err, "Fetch failed");
  }
});

app.put("/kb/:name/documents/:documentId", async (c) => {
  const documentId = Number(c.req.param("documentId"));
  if (!Number.isInteger(documentId)) {
    return c.json({ error: "documentId must be an integer" }, 400);
  }

  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = z
    .object({ text: z.string().min(1).optional(), metadata: z.unknown().optional() })
    .safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    const result = await updateDocument(c.req.param("name"), documentId, parsed.data);
    return c.json(result);
  } catch (err) {
    return mapRagError(c, err, "Update failed");
  }
});

app.delete("/kb/:name/documents/:documentId", (c) => {
  const documentId = Number(c.req.param("documentId"));
  if (!Number.isInteger(documentId)) {
    return c.json({ error: "documentId must be an integer" }, 400);
  }

  try {
    deleteDocument(c.req.param("name"), documentId);
    return c.json({ deleted: true });
  } catch (err) {
    return mapRagError(c, err, "Delete failed");
  }
});

app.post("/kb/:name/search", async (c) => {
  const parsedBody = await readJsonBody(c);
  if (!parsedBody.ok) return badJson(c);

  const parsed = z
    .object({
      query: z.string().min(1),
      topK: z.number().int().positive().max(500).optional(),
      filter: z.record(z.unknown()).optional(),
      maxDistance: z.number().nonnegative().optional(),
    })
    .safeParse(parsedBody.body);
  if (!parsed.success) return c.json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  try {
    const results = await searchKb(c.req.param("name"), parsed.data.query, {
      topK: parsed.data.topK,
      filter: parsed.data.filter,
      maxDistance: parsed.data.maxDistance,
    });
    return c.json({ results });
  } catch (err) {
    return mapRagError(c, err, "Search failed");
  }
});

// v2.3 — conversation memory. Writing happens inside invokeAgent/invokeAgentStream
// (POST /agents/:name/invoke with a conversationId in the body); these two
// routes are just raw read/clear for app-side display or debugging.
app.get("/memory", (c) => {
  return c.json({ conversations: listConversations() });
});

app.get("/memory/:conversationId", (c) => {
  const conversationId = c.req.param("conversationId");
  return c.json({ conversationId, turns: getConversationTurns(conversationId) });
});

app.delete("/memory/:conversationId", (c) => {
  return c.json({ cleared: clearConversation(c.req.param("conversationId")) });
});

// Last-resort fallback — every route above maps its own known error types to
// the documented { error } shape; this only catches whatever still slips
// through (a genuinely unexpected bug), so it doesn't leak Hono's default
// (non-JSON) error response or a raw stack trace.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Homebase listening on http://localhost:${info.port}`);
});
