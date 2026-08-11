import { embed } from "ai";
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
