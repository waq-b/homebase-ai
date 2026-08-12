import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentsDetailed } from "./registry.js";

// Regression test for the bug where readFile/yaml.load ran outside the
// per-file try/catch: a YAML *syntax* error would abort the whole load
// instead of being isolated like a schema-validation error.

const validAgent = `
name: valid-agent
description: A valid test agent
provider: ollama
model: llama3:latest
input:
  type: string
`;

// Unclosed quote — a genuine YAML syntax error, not a schema problem.
const syntaxBrokenAgent = `
name: "broken-syntax
description: missing closing quote
provider: ollama
model: llama3:latest
input:
  type: string
`;

// Valid YAML, but fails Zod validation (missing required fields).
const schemaInvalidAgent = `
name: broken-schema
provider: ollama
`;

describe("loadAgentsDetailed", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "homebase-registry-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads the valid agent and isolates both a syntax-broken and a schema-invalid file", async () => {
    await writeFile(path.join(dir, "valid.yaml"), validAgent);
    await writeFile(path.join(dir, "syntax-broken.yaml"), syntaxBrokenAgent);
    await writeFile(path.join(dir, "schema-invalid.yaml"), schemaInvalidAgent);

    const { agents, errors } = await loadAgentsDetailed(dir);

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("valid-agent");

    expect(errors).toHaveLength(2);
    const errorFiles = errors.map((e) => e.file).sort();
    expect(errorFiles).toEqual(["schema-invalid.yaml", "syntax-broken.yaml"]);
  });

  it("returns an empty result for a nonexistent directory instead of throwing", async () => {
    const { agents, errors } = await loadAgentsDetailed(path.join(dir, "does-not-exist"));
    expect(agents).toEqual([]);
    expect(errors).toEqual([]);
  });
});
