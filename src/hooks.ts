import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentConfig } from "./config.js";
import { AGENTS_DIR } from "./registry.js";

export interface InvokeContext {
  agent: AgentConfig;
}

export interface AgentHooks {
  beforeInvoke?: (input: unknown, ctx: InvokeContext) => unknown | Promise<unknown>;
  afterInvoke?: (output: string, ctx: InvokeContext) => string | Promise<string>;
  tools?: Record<string, unknown>;
}

export class HookError extends Error {
  constructor(
    public readonly hook: string,
    cause: unknown,
  ) {
    super(`Hook "${hook}" threw: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "HookError";
  }
}

/** Loads an agent's optional *.hooks.ts file. Agents with no hooks field get {}. */
export const loadHooks = async (agent: AgentConfig): Promise<AgentHooks> => {
  if (!agent.hooks) return {};
  const hooksPath = path.join(AGENTS_DIR, agent.hooks);
  const mod = await import(pathToFileURL(hooksPath).href);
  return (mod.default ?? {}) as AgentHooks;
};

export const runHook = async <T>(
  name: "beforeInvoke" | "afterInvoke",
  hook: ((value: T, ctx: InvokeContext) => T | Promise<T>) | undefined,
  value: T,
  ctx: InvokeContext,
): Promise<T> => {
  if (!hook) return value;
  try {
    return await hook(value, ctx);
  } catch (err) {
    throw new HookError(name, err);
  }
};
