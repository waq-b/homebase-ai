import { HomebaseAgentError, HomebaseUnreachableError } from "./errors.js";
import { createKbClient } from "./kb.js";
import { createMemoryClient } from "./memory.js";

export interface InvokeOptions {
  conversationId?: string;
}

export interface StreamFrame {
  delta?: string;
  toolCall?: { name: string; args: unknown };
  toolResult?: { name: string; result: unknown };
  error?: string;
  done?: boolean;
}

/**
 * Thin wrapper around Homebase's HTTP API — `POST /agents/:name/invoke`, its SSE streaming
 * variant, and `GET /health`. Deliberately has no opinion about mock-vs-live: that's app-specific
 * (a mock is a stand-in for a specific agent's contract, which this package doesn't know about),
 * so callers that want a mock mode branch on their own config before calling `invokeAgent`.
 */
export const createHomebaseClient = (baseUrl: string = process.env.HOMEBASE_URL ?? "http://localhost:3000") => {
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
    } catch (err) {
      throw new HomebaseUnreachableError(err);
    }
  };

  /** Invokes an agent and returns its raw text output (agents always return `{ output: string }`). */
  const invokeAgent = async (agentName: string, input: unknown, options: InvokeOptions = {}): Promise<string> => {
    const response = await request(`/agents/${encodeURIComponent(agentName)}/invoke`, {
      method: "POST",
      body: JSON.stringify({ input, conversationId: options.conversationId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HomebaseAgentError(agentName, response.status, body);
    }
    const body = (await response.json()) as { output: string };
    return body.output;
  };

  /** Streams an agent's response via SSE, yielding each parsed frame as it arrives. */
  const invokeAgentStream = async function* (
    agentName: string,
    input: unknown,
    options: InvokeOptions = {},
  ): AsyncGenerator<StreamFrame> {
    const response = await request(`/agents/${encodeURIComponent(agentName)}/invoke?stream=true`, {
      method: "POST",
      body: JSON.stringify({ input, conversationId: options.conversationId }),
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      throw new HomebaseAgentError(agentName, response.status, body);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        yield JSON.parse(line.slice("data: ".length)) as StreamFrame;
      }
    }
  };

  const health = async (): Promise<boolean> => {
    try {
      const response = await request("/health");
      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    baseUrl,
    invokeAgent,
    invokeAgentStream,
    health,
    request,
    kb: createKbClient(request),
    memory: createMemoryClient(request),
  };
};

export type HomebaseClient = ReturnType<typeof createHomebaseClient>;
