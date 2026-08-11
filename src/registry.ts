import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { agentConfigSchema, type AgentConfig } from "./config.js";

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");

export class AgentConfigError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "AgentConfigError";
  }
}

/** Reads and validates every agents/*.yaml file from disk. Re-read on every call — no caching. */
export const loadAgents = async (): Promise<AgentConfig[]> => {
  let files: string[];
  try {
    files = await readdir(AGENTS_DIR);
  } catch {
    return [];
  }

  const yamlFiles = files.filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));

  const agents: AgentConfig[] = [];
  for (const file of yamlFiles) {
    const raw = await readFile(path.join(AGENTS_DIR, file), "utf-8");
    const parsed = yaml.load(raw);
    const result = agentConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new AgentConfigError(file, result.error.message);
    }
    agents.push(result.data);
  }
  return agents;
};

export const getAgent = async (name: string): Promise<AgentConfig | undefined> => {
  const agents = await loadAgents();
  return agents.find((agent) => agent.name === name);
};
