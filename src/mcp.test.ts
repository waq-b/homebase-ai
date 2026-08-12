import { describe, expect, it, vi } from "vitest";

const createMCPClient = vi.fn();

vi.mock("ai", () => ({
  experimental_createMCPClient: (...args: unknown[]) => createMCPClient(...args),
}));

// Imported after the mock so mcp.ts picks up the mocked "ai" module.
const { connectMcpServers, McpConnectionError } = await import("./mcp.js");

describe("connectMcpServers", () => {
  it("closes a successfully-connected server and names the one that failed, when one of two rejects", async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const okClient = {
      tools: vi.fn().mockResolvedValue({ someTool: {} }),
      close: closeSpy,
    };

    createMCPClient.mockImplementation(({ name }: { name: string }) => {
      if (name === "good-server") return Promise.resolve(okClient);
      return Promise.reject(new Error("connection refused"));
    });

    await expect(
      connectMcpServers({
        mcpServers: [
          { name: "good-server", url: "http://good.example/sse" },
          { name: "bad-server", url: "http://bad.example/sse" },
        ],
      }),
    ).rejects.toThrow(McpConnectionError);

    expect(closeSpy).toHaveBeenCalledTimes(1);

    try {
      await connectMcpServers({
        mcpServers: [
          { name: "good-server", url: "http://good.example/sse" },
          { name: "bad-server", url: "http://bad.example/sse" },
        ],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(McpConnectionError);
      expect((err as Error).message).toContain("bad-server");
    }
  });

  it("returns no-op tools/close when the agent declares no mcpServers", async () => {
    const connection = await connectMcpServers({ mcpServers: undefined });
    expect(connection.tools).toEqual({});
    await expect(connection.close()).resolves.toBeUndefined();
  });
});
