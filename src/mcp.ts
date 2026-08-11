import { experimental_createMCPClient as createMCPClient, type ToolSet } from "ai";
import type { AgentConfig } from "./config.js";

export interface McpConnection {
  tools: ToolSet;
  close: () => Promise<void>;
}

const NO_MCP_TOOLS: McpConnection = { tools: {}, close: async () => {} };

/**
 * v2.4 — connects to every MCP server an agent declares (agents/*.yaml
 * `mcpServers`), at invoke time (per-request, matching the rest of Homebase's
 * re-read-every-request model). Returned tools merge with hooks.ts tools in
 * invoke.ts — additive, existing hooks-only agents are unaffected since
 * `mcpServers` is optional and this returns {} when it's absent.
 *
 * Connecting fresh per invoke costs a round trip per call; acceptable for
 * v1 given MCP is the lowest-priority v2 piece. Revisit (e.g. connection
 * pooling by server url) if latency matters for a real MCP-tool-heavy agent.
 */
export const connectMcpServers = async (
  agent: Pick<AgentConfig, "mcpServers">,
): Promise<McpConnection> => {
  const servers = agent.mcpServers;
  if (!servers || servers.length === 0) return NO_MCP_TOOLS;

  const clients = await Promise.all(
    servers.map((server) =>
      createMCPClient({ name: server.name, transport: { type: "sse", url: server.url } }),
    ),
  );

  const toolSets = await Promise.all(clients.map((client) => client.tools()));
  const tools: ToolSet = Object.assign({}, ...toolSets);

  return {
    tools,
    close: async () => {
      await Promise.all(clients.map((client) => client.close()));
    },
  };
};
