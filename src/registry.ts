import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { agentConfigSchema, type AgentConfig } from "./config.js";

export const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");

export class AgentConfigError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "AgentConfigError";
  }
}

export interface AgentLoadResult {
  agents: AgentConfig[];
  errors: AgentConfigError[];
}

/**
 * Reads and validates every agents/*.yaml file from disk. Re-read on every
 * call — no caching. A malformed file is skipped and reported in `errors`
 * rather than aborting the whole load — one broken agent config shouldn't
 * take every other agent (and /openapi.json, /docs) down with it.
 */
export const loadAgentsDetailed = async (): Promise<AgentLoadResult> => {
  let files: string[];
  try {
    files = await readdir(AGENTS_DIR);
  } catch {
    return { agents: [], errors: [] };
  }

  const yamlFiles = files.filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));

  const agents: AgentConfig[] = [];
  const errors: AgentConfigError[] = [];
  for (const file of yamlFiles) {
    const raw = await readFile(path.join(AGENTS_DIR, file), "utf-8");
    const parsed = yaml.load(raw);
    const result = agentConfigSchema.safeParse(parsed);
    if (!result.success) {
      const error = new AgentConfigError(file, result.error.message);
      errors.push(error);
      console.error(`Skipping invalid agent config: ${error.message}`);
      continue;
    }
    agents.push(result.data);
  }
  return { agents, errors };
};

export const loadAgents = async (): Promise<AgentConfig[]> => {
  const { agents } = await loadAgentsDetailed();
  return agents;
};
