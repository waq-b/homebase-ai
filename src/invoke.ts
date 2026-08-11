import { generateText, streamText, type CoreMessage, type ToolSet } from "ai";
import type { z } from "zod";
import { inputPayloadSchema, type AgentConfig } from "./config.js";
import { getModel } from "./providers.js";
import { loadHooks, runHook, type InvokeContext } from "./hooks.js";
import { connectMcpServers } from "./mcp.js";
import { appendConversationTurn, getConversationTurns, type TurnRole } from "./memory.js";

export class InputValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super("Invalid input");
    this.name = "InputValidationError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Just the messages this input produces — no system message (that's composed separately in prepare()). */
const turnMessages = (agent: AgentConfig, input: unknown): CoreMessage[] => {
  if (agent.input.type === "string") {
    return [{ role: "user", content: input as string }];
  }
  if (agent.input.type === "messages") {
    return input as CoreMessage[];
  }
  return [{ role: "user", content: JSON.stringify(input) }];
};

/** Tool-calling round-trips (call -> result -> follow-up) can take a few steps. */
const MAX_TOOL_STEPS = 5;

/** v2.3 — an optional `conversationId` alongside `input` opts an invoke into memory. Not part of the Zod input schema (that stays per-agent-type), so it's read straight off the raw body. */
const extractConversationId = (rawBody: unknown): string | undefined => {
  if (typeof rawBody !== "object" || rawBody === null) return undefined;
  const value = (rawBody as Record<string, unknown>).conversationId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const prepare = async (agent: AgentConfig, rawBody: unknown) => {
  const parsed = inputPayloadSchema(agent.input).safeParse(rawBody);
  if (!parsed.success) throw new InputValidationError(parsed.error.issues);

  const hooks = await loadHooks(agent);
  const mcp = await connectMcpServers(agent);
  const tools: ToolSet = { ...hooks.tools, ...mcp.tools };

  const ctx: InvokeContext = { agent };
  const input = await runHook("beforeInvoke", hooks.beforeInvoke, parsed.data.input, ctx);
  ctx.input = input;

  const conversationId = extractConversationId(rawBody);
  const priorTurns: CoreMessage[] = conversationId
    ? getConversationTurns(conversationId).map((turn) => ({ role: turn.role, content: turn.content }))
    : [];
  const newTurns = turnMessages(agent, input);

  const messages: CoreMessage[] = [];
  if (agent.system) messages.push({ role: "system", content: agent.system });
  messages.push(...priorTurns, ...newTurns);

  return { hooks, tools, mcpClose: mcp.close, ctx, messages, conversationId, newTurns };
};

const callSettings = (agent: AgentConfig, tools: ToolSet) => {
  const hasTools = Object.keys(tools).length > 0;
  return {
    model: getModel(agent, { hasTools }),
    temperature: agent.params?.temperature,
    maxTokens: agent.params?.maxTokens,
    ...(hasTools ? { tools, maxSteps: MAX_TOOL_STEPS } : {}),
  };
};

/** A CoreMessage's content is always a plain string for what Homebase itself constructs. */
const textOf = (content: CoreMessage["content"]): string =>
  typeof content === "string" ? content : JSON.stringify(content);

const persistTurns = (conversationId: string, newTurns: CoreMessage[], assistantOutput: string) => {
  for (const turn of newTurns) {
    appendConversationTurn(conversationId, turn.role as TurnRole, textOf(turn.content));
  }
  appendConversationTurn(conversationId, "assistant", assistantOutput);
};

/** Runs an agent end-to-end: validate input -> beforeInvoke -> model call (w/ tool-calling) -> afterInvoke. */
export const invokeAgent = async (agent: AgentConfig, rawBody: unknown): Promise<string> => {
  const { hooks, tools, mcpClose, ctx, messages, conversationId, newTurns } = await prepare(agent, rawBody);

  let text: string;
  try {
    const result = await generateText({ ...callSettings(agent, tools), messages });
    text = result.text;
  } catch (err) {
    await mcpClose();
    throw new ProviderError(err instanceof Error ? err.message : "Model call failed", err);
  }
  await mcpClose();

  const output = await runHook("afterInvoke", hooks.afterInvoke, text, ctx);
  if (conversationId) persistTurns(conversationId, newTurns, output);

  return output;
};

/**
 * Runs an agent for SSE streaming, with tool-calling if the agent defines
 * tools. afterInvoke does not apply here — tokens are already flushed to
 * the client by the time the full text is known.
 */
export const invokeAgentStream = async (agent: AgentConfig, rawBody: unknown) => {
  const { tools, mcpClose, messages, conversationId, newTurns } = await prepare(agent, rawBody);

  try {
    return streamText({
      ...callSettings(agent, tools),
      messages,
      onFinish: async ({ text }) => {
        if (conversationId) persistTurns(conversationId, newTurns, text);
        await mcpClose();
      },
    });
  } catch (err) {
    await mcpClose();
    throw new ProviderError(err instanceof Error ? err.message : "Model call failed", err);
  }
};
