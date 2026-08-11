import { createOllama } from "ollama-ai-provider";
import type { LanguageModel } from "ai";
import type { AgentConfig } from "./config.js";

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api",
});

/** Maps an agent's provider/model config to a runnable AI SDK model instance. */
export const getModel = (config: Pick<AgentConfig, "provider" | "model">): LanguageModel => {
  switch (config.provider) {
    case "ollama":
      return ollama(config.model);
    default:
      config.provider satisfies never;
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
};
