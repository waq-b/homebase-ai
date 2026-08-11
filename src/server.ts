import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { Scalar } from "@scalar/hono-api-reference";
import { AgentConfigError, getAgent, loadAgents } from "./registry.js";
import { HookError } from "./hooks.js";
import { InputValidationError, ProviderError, invokeAgent, invokeAgentStream } from "./invoke.js";
import { buildOpenApiSpec } from "./openapi.js";

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

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

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

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Homebase listening on http://localhost:${info.port}`);
});
