import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

/**
 * Minimal proof-of-concept MCP server for v2.4 (MCP client support) — a
 * self-contained, keyless "external" server Homebase can connect to over
 * SSE, separate from Homebase's own process. Not a real integration (no
 * third-party API/credentials involved); swap in a real MCP server's url in
 * an agent's `mcpServers` config using the exact same shape.
 */
const server = new McpServer({ name: "homebase-demo-time", version: "1.0.0" });

server.tool("getCurrentTime", "Returns the current date and time (ISO 8601, server-local).", {}, async () => ({
  content: [{ type: "text", text: new Date().toISOString() }],
}));

server.tool(
  "rollDice",
  "Rolls an N-sided die (default 6) and returns the result.",
  { sides: z.number().int().positive().optional() },
  async ({ sides }) => {
    const n = sides ?? 6;
    const result = Math.floor(Math.random() * n) + 1;
    return { content: [{ type: "text", text: `Rolled a d${n}: ${result}` }] };
  },
);

const transports = new Map<string, SSEServerTransport>();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/sse") {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await server.connect(transport);
    return;
  }

  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(400).end("No transport found for sessionId");
      return;
    }
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404).end();
});

const port = Number(process.env.MCP_DEMO_PORT ?? 8787);
httpServer.listen(port, () => {
  console.log(`MCP demo server (time/dice) listening on http://localhost:${port}/sse`);
});
