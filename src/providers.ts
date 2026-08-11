import { createOllama } from "ollama-ai-provider";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AgentConfig } from "./config.js";

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api",
});

export const DEFAULT_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";

export const getEmbeddingModel = (modelId: string = DEFAULT_EMBEDDING_MODEL): EmbeddingModel<string> =>
  ollama.embedding(modelId);

/**
 * Maps an agent's provider/model config to a runnable AI SDK model instance.
 *
 * `simulateStreaming` forces `hasTools` agents onto a generate-then-chunk
 * path instead of Ollama's raw token stream: ollama-ai-provider's in-stream
 * tool-call detection is unreliable (confirmed — the tool silently never
 * fired, and the model emitted garbage tokens instead), while the
 * non-streaming path round-trips tool calls correctly. Tool-less agents keep
 * real token-by-token streaming.
 */
export const getModel = (
  config: Pick<AgentConfig, "provider" | "model">,
  options: { hasTools?: boolean } = {},
): LanguageModel => {
  switch (config.provider) {
    case "ollama":
      return ollama(config.model, { simulateStreaming: options.hasTools });
    default:
      config.provider satisfies never;
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
};
