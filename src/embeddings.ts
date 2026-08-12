import { embed, embedMany } from "ai";
import { DEFAULT_EMBEDDING_MODEL, getEmbeddingModel } from "./providers.js";

export interface EmbedResult {
  vector: number[];
  model: string;
}

/** v2.1 — turns text into a vector. Pure compute, no storage (RAG in v2.2 owns storage). */
export const embedText = async (text: string, model?: string): Promise<EmbedResult> => {
  const modelId = model ?? DEFAULT_EMBEDDING_MODEL;
  const { embedding } = await embed({ model: getEmbeddingModel(modelId), value: text });
  return { vector: embedding, model: modelId };
};

export interface EmbedManyResult {
  vectors: number[][];
  model: string;
}

/**
 * Batch variant — one real HTTP call to Ollama's /api/embed for all `texts`
 * (ollama-ai-provider's doEmbed sends the whole array as `input` in a single
 * POST, up to maxEmbeddingsPerCall — 2048 by default), not a loop of single
 * embed calls. Used both by POST /embed's batch mode and internally by
 * rag.ts to embed a document's chunks in one round trip instead of one
 * request per chunk.
 */
export const embedTexts = async (texts: string[], model?: string): Promise<EmbedManyResult> => {
  const modelId = model ?? DEFAULT_EMBEDDING_MODEL;
  const { embeddings } = await embedMany({ model: getEmbeddingModel(modelId), values: texts });
  return { vectors: embeddings, model: modelId };
};
