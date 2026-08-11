import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AgentConfigError, loadAgents } from "./registry.js";

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

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Homebase listening on http://localhost:${info.port}`);
});
