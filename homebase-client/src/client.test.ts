import { afterEach, describe, expect, it, vi } from "vitest";
import { createHomebaseClient } from "./client.js";
import { HomebaseAgentError, HomebaseUnreachableError } from "./errors.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invokeAgent", () => {
  it("returns the agent's output on a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ output: "hello" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHomebaseClient("http://localhost:9999");
    const output = await client.invokeAgent("summarizer", "some text");

    expect(output).toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9999/agents/summarizer/invoke",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws HomebaseAgentError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, { status: 400 })));
    const client = createHomebaseClient("http://localhost:9999");

    await expect(client.invokeAgent("summarizer", "x")).rejects.toBeInstanceOf(HomebaseAgentError);
  });

  it("throws HomebaseUnreachableError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = createHomebaseClient("http://localhost:9999");

    await expect(client.invokeAgent("summarizer", "x")).rejects.toBeInstanceOf(HomebaseUnreachableError);
  });
});

describe("invokeAgentStream", () => {
  it("yields each SSE frame parsed from the response body", async () => {
    const sse = 'data: {"delta":"Hel"}\n\ndata: {"delta":"lo"}\n\ndata: {"done":true}\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const client = createHomebaseClient("http://localhost:9999");
    const frames = [];
    for await (const frame of client.invokeAgentStream("chat", "hi")) frames.push(frame);

    expect(frames).toEqual([{ delta: "Hel" }, { delta: "lo" }, { done: true }]);
  });
});
