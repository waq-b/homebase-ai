import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentOutputError } from "./errors.js";
import { parseAgentOutput } from "./parseAgentOutput.js";

const schema = z.object({ summary: z.string() });

describe("parseAgentOutput", () => {
  it("returns the parsed value when JSON matches the schema", () => {
    const result = parseAgentOutput("summarizer", '{"summary":"short"}', schema);
    expect(result).toEqual({ summary: "short" });
  });

  it("throws AgentOutputError for non-JSON output", () => {
    expect(() => parseAgentOutput("summarizer", "not json", schema)).toThrow(AgentOutputError);
  });

  it("throws AgentOutputError (with issues) for JSON that doesn't match the schema", () => {
    try {
      parseAgentOutput("summarizer", '{"wrong":"shape"}', schema);
      throw new Error("expected parseAgentOutput to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentOutputError);
      expect((err as AgentOutputError).issues).toBeDefined();
    }
  });
});
