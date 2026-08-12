import { tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./config.js";
import { appendConversationTurn, clearConversation } from "./memory.js";

// Mocked so tool-merging tests are deterministic and need no real hooks.ts
// file on disk or real MCP server — memory-ordering tests below don't use
// these mocks and hit the real local SQLite DB instead (fast, no network,
// consistent with this project's "real over mock for local things" approach).
vi.mock("./hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks.js")>();
  return { ...actual, loadHooks: vi.fn(actual.loadHooks) };
});
vi.mock("./mcp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp.js")>();
  return { ...actual, connectMcpServers: vi.fn(actual.connectMcpServers) };
});

const { loadHooks } = await import("./hooks.js");
const { connectMcpServers } = await import("./mcp.js");
const { prepare } = await import("./invoke.js");

const baseAgent: AgentConfig = {
  name: "test-agent",
  description: "test",
  provider: "ollama",
  model: "llama3:latest",
  input: { type: "string" },
};

const fakeTool = () => tool({ description: "fake", parameters: z.object({}), execute: async () => "ok" });

describe("prepare — memory-turn ordering", () => {
  afterEach(() => {
    vi.mocked(loadHooks).mockReset();
    vi.mocked(connectMcpServers).mockReset();
  });

  it("conversationId-absent calls are unaffected: messages are exactly [system?, ...newTurns]", async () => {
    vi.mocked(loadHooks).mockResolvedValue({});
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: {}, close: async () => {} });

    const agent: AgentConfig = { ...baseAgent, system: "You are helpful." };
    const { messages, conversationId } = await prepare(agent, { input: "hello" });

    expect(conversationId).toBeUndefined();
    expect(messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hello" },
    ]);
  });

  it("prior turns load ahead of the new turn, with the system message first", async () => {
    vi.mocked(loadHooks).mockResolvedValue({});
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: {}, close: async () => {} });

    const conversationId = `test-memory-ordering-${Date.now()}`;
    appendConversationTurn(conversationId, "user", "first message");
    appendConversationTurn(conversationId, "assistant", "first reply");

    try {
      const agent: AgentConfig = { ...baseAgent, system: "Sys prompt" };
      const { messages } = await prepare(agent, { input: "second message", conversationId });

      expect(messages).toEqual([
        { role: "system", content: "Sys prompt" },
        { role: "user", content: "first message" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "second message" },
      ]);
    } finally {
      clearConversation(conversationId);
    }
  });

  it("no system message on the agent means no system entry, prior turns still load", async () => {
    vi.mocked(loadHooks).mockResolvedValue({});
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: {}, close: async () => {} });

    const conversationId = `test-memory-no-system-${Date.now()}`;
    appendConversationTurn(conversationId, "user", "earlier");

    try {
      const { messages } = await prepare(baseAgent, { input: "now", conversationId });
      expect(messages).toEqual([
        { role: "user", content: "earlier" },
        { role: "user", content: "now" },
      ]);
    } finally {
      clearConversation(conversationId);
    }
  });
});

describe("prepare — tool merging", () => {
  afterEach(() => {
    vi.mocked(loadHooks).mockReset();
    vi.mocked(connectMcpServers).mockReset();
  });

  it("hooks-only tools work with no mcpServers", async () => {
    vi.mocked(loadHooks).mockResolvedValue({ tools: { hookTool: fakeTool() } });
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: {}, close: async () => {} });

    const { tools } = await prepare(baseAgent, { input: "x" });
    expect(Object.keys(tools)).toEqual(["hookTool"]);
  });

  it("MCP-only tools work with no hooks tools", async () => {
    vi.mocked(loadHooks).mockResolvedValue({});
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: { mcpTool: fakeTool() }, close: async () => {} });

    const { tools } = await prepare(baseAgent, { input: "x" });
    expect(Object.keys(tools)).toEqual(["mcpTool"]);
  });

  it("hooks + MCP tools merge together", async () => {
    vi.mocked(loadHooks).mockResolvedValue({ tools: { hookTool: fakeTool() } });
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: { mcpTool: fakeTool() }, close: async () => {} });

    const { tools } = await prepare(baseAgent, { input: "x" });
    expect(Object.keys(tools).sort()).toEqual(["hookTool", "mcpTool"]);
  });

  it("on a name collision, the MCP tool wins (documented precedence in docs/mcp.md)", async () => {
    const hooksTool = fakeTool();
    const mcpTool = fakeTool();
    vi.mocked(loadHooks).mockResolvedValue({ tools: { shared: hooksTool } });
    vi.mocked(connectMcpServers).mockResolvedValue({ tools: { shared: mcpTool }, close: async () => {} });

    const { tools } = await prepare(baseAgent, { input: "x" });
    expect(tools.shared).toBe(mcpTool);
  });
});
