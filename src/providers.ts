import { createOllama } from "ollama-ai-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AgentConfig } from "./config.js";

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  usage: { total_tokens: number };
}

/**
 * No AI-SDK provider package for Voyage is usable here: `@ai-sdk/voyage`
 * depends on `@ai-sdk/provider@4.x`, while this project's `ai@4.3.19` is on
 * `@ai-sdk/provider@1.x` — incompatible `EmbeddingModel` shapes. Hand-rolled
 * against Voyage's plain REST API instead (https://docs.voyageai.com),
 * implementing just enough of `EmbeddingModelV1<string>` for `embed`/
 * `embedMany` (src/embeddings.ts) to work against it unmodified.
 */
const voyageEmbeddingModel = (modelId: string): EmbeddingModel<string> => ({
  specificationVersion: "v1",
  provider: "voyage",
  modelId,
  maxEmbeddingsPerCall: 1000,
  supportsParallelCalls: true,
  doEmbed: async ({ values, abortSignal, headers }) => {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ input: values, model: modelId }),
      signal: abortSignal,
    });
    if (!res.ok) {
      throw new Error(`Voyage embeddings request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as VoyageEmbeddingResponse;
    const embeddings = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { embeddings, usage: { tokens: body.usage.total_tokens } };
  },
});

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

// Voyage, not Ollama: Ollama Cloud (this file's default `ollama` client)
// doesn't serve embedding models (a live call returned 401).
export const DEFAULT_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "voyage-4-lite";

export const getEmbeddingModel = (modelId: string = DEFAULT_EMBEDDING_MODEL): EmbeddingModel<string> =>
  voyageEmbeddingModel(modelId);

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
