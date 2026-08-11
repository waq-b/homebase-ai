import { generateText, streamText, type CoreMessage } from "ai";
import type { z } from "zod";
import { inputPayloadSchema, type AgentConfig } from "./config.js";
import { getModel } from "./providers.js";
import { loadHooks, runHook, type AgentHooks, type InvokeContext } from "./hooks.js";

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

const toMessages = (agent: AgentConfig, input: unknown): CoreMessage[] => {
  const messages: CoreMessage[] = [];
  if (agent.system) messages.push({ role: "system", content: agent.system });

  if (agent.input.type === "string") {
    messages.push({ role: "user", content: input as string });
  } else if (agent.input.type === "messages") {
    messages.push(...(input as CoreMessage[]));
  } else {
    messages.push({ role: "user", content: JSON.stringify(input) });
  }
  return messages;
};

/** Tool-calling round-trips (call -> result -> follow-up) can take a few steps. */
const MAX_TOOL_STEPS = 5;

const prepare = async (agent: AgentConfig, rawBody: unknown) => {
  const parsed = inputPayloadSchema(agent.input).safeParse(rawBody);
  if (!parsed.success) throw new InputValidationError(parsed.error.issues);

  const hooks = await loadHooks(agent);
  const ctx: InvokeContext = { agent };
  const input = await runHook("beforeInvoke", hooks.beforeInvoke, parsed.data.input, ctx);

  return { hooks, ctx, messages: toMessages(agent, input) };
};

const callSettings = (agent: AgentConfig, hooks: AgentHooks) => {
  const hasTools = Boolean(hooks.tools && Object.keys(hooks.tools).length > 0);
  return {
    model: getModel(agent, { hasTools }),
    temperature: agent.params?.temperature,
    maxTokens: agent.params?.maxTokens,
    ...(hasTools ? { tools: hooks.tools, maxSteps: MAX_TOOL_STEPS } : {}),
  };
};

/** Runs an agent end-to-end: validate input -> beforeInvoke -> model call (w/ tool-calling) -> afterInvoke. */
export const invokeAgent = async (agent: AgentConfig, rawBody: unknown): Promise<string> => {
  const { hooks, ctx, messages } = await prepare(agent, rawBody);

  let text: string;
  try {
    const result = await generateText({ ...callSettings(agent, hooks), messages });
    text = result.text;
  } catch (err) {
    throw new ProviderError(err instanceof Error ? err.message : "Model call failed", err);
  }

  return runHook("afterInvoke", hooks.afterInvoke, text, ctx);
};

/**
 * Runs an agent for SSE streaming, with tool-calling if the agent defines
 * tools. afterInvoke does not apply here — tokens are already flushed to
 * the client by the time the full text is known.
 */
export const invokeAgentStream = async (agent: AgentConfig, rawBody: unknown) => {
  const { hooks, messages } = await prepare(agent, rawBody);

  try {
    return streamText({ ...callSettings(agent, hooks), messages });
  } catch (err) {
    throw new ProviderError(err instanceof Error ? err.message : "Model call failed", err);
  }
};
