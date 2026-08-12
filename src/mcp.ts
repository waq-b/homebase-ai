import { experimental_createMCPClient as createMCPClient, type ToolSet } from "ai";
import type { AgentConfig } from "./config.js";

export interface McpConnection {
  tools: ToolSet;
  close: () => Promise<void>;
}

export class McpConnectionError extends Error {
  constructor(serverName: string, cause: unknown) {
    super(
      `Failed to connect to MCP server "${serverName}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "McpConnectionError";
  }
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

  // Promise.allSettled (not .all) — one server failing to connect must not
  // leak any siblings in the same batch that *did* connect successfully.
  const settled = await Promise.allSettled(
    servers.map((server) =>
      createMCPClient({ name: server.name, transport: { type: "sse", url: server.url } }),
    ),
  );

  const clients = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  const failedIndex = settled.findIndex((result) => result.status === "rejected");
  if (failedIndex !== -1) {
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
    const failure = settled[failedIndex] as PromiseRejectedResult;
    throw new McpConnectionError(servers[failedIndex].name, failure.reason);
  }

  const toolSets = await Promise.all(clients.map((client) => client.tools()));
  const tools: ToolSet = Object.assign({}, ...toolSets);

  return {
    tools,
    close: async () => {
      await Promise.all(clients.map((client) => client.close().catch(() => {})));
    },
  };
};
