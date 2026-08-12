import { createOllama } from "ollama-ai-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AgentConfig } from "./config.js";

const ollama = createOllama({
  // Defaults to Ollama Cloud (https://ollama.com/api) rather than a local
  // install — swap OLLAMA_BASE_URL to http://localhost:11434/api once a
  // local/LAN box is running inference again.
  baseURL: process.env.OLLAMA_BASE_URL ?? "https://ollama.com/api",
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : undefined,
});

// Lazy: only constructed (and only requires OPENROUTER_API_KEY) the first
// time an agent actually asks for the openrouter provider, so Ollama-only
// setups never need the env var set.
let openrouter: ReturnType<typeof createOpenRouter> | undefined;
const getOpenrouter = () => {
  if (!openrouter) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    openrouter = createOpenRouter({ apiKey });
  }
  return openrouter;
};

// Fallback used when the default (Ollama Cloud) call fails — a free
// OpenRouter model, only engaged if OPENROUTER_API_KEY is set. An agent's
// own `fallbackModel` (config.ts) takes priority over this global default.
const DEFAULT_FALLBACK_MODEL = process.env.OPENROUTER_FALLBACK_MODEL ?? "openai/gpt-oss-20b:free";

export const getFallbackModel = (modelId?: string): LanguageModel | undefined =>
  process.env.OPENROUTER_API_KEY ? getOpenrouter()(modelId ?? DEFAULT_FALLBACK_MODEL) : undefined;

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
    case "openrouter":
      return getOpenrouter()(config.model);
    default:
      config.provider satisfies never;
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
};
