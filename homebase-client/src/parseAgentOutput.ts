import type { z } from "zod";
import { AgentOutputError } from "./errors.js";

/**
 * Parses an agent's raw text output (from `invokeAgent`) as JSON and validates it against
 * `schema`, throwing `AgentOutputError` on either failure — malformed JSON or a shape that
 * doesn't match. Homebase itself does no output validation (see its docs/tools-and-hooks.md);
 * this is the calling-app-side half of that contract.
 */
export const parseAgentOutput = <T>(agentName: string, raw: string, schema: z.ZodType<T>): T => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AgentOutputError(agentName, raw);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AgentOutputError(agentName, raw, parsed.error.issues);
  }
  return parsed.data;
};
