import { HomebaseKbError } from "./errors.js";

type Requester = (path: string, init?: RequestInit) => Promise<Response>;

export interface KbSummary {
  name: string;
  embeddingModel: string;
  dimension: number;
  documentCount: number;
  chunkCount: number;
}

export interface AddDocumentResult {
  documentId: number;
  chunksAdded: number;
  embeddingModel: string;
}

export interface DocumentSummary {
  id: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

export interface DocumentDetail {
  id: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  content: string;
}

export interface UpdateDocumentResult {
  documentId: number;
  chunksAdded: number;
}

export interface SearchResult {
  content: string;
  score: number;
  chunkIndex: number;
  documentId: number;
  metadata: unknown;
}

/** Client for Homebase's RAG knowledge-base endpoints (`/kb`, `/kb/:name/*`) — always hits the real Homebase server, there's no meaningful way to mock a knowledge base you're trying to actually populate. */
export const createKbClient = (request: Requester) => {
  const parseOrThrow = async <T>(response: Response, kbName: string): Promise<T> => {
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HomebaseKbError(kbName, response.status, body);
    }
    return (await response.json()) as T;
  };

  const listKbs = async (): Promise<KbSummary[]> => {
    const response = await request("/kb");
    const body = await parseOrThrow<{ kbs: KbSummary[] }>(response, "*");
    return body.kbs;
  };

  const deleteKb = async (kbName: string): Promise<void> => {
    const response = await request(`/kb/${encodeURIComponent(kbName)}`, { method: "DELETE" });
    await parseOrThrow<{ deleted: boolean }>(response, kbName);
  };

  const addDocument = async (
    kbName: string,
    text: string,
    options: { metadata?: unknown; model?: string } = {},
  ): Promise<AddDocumentResult> => {
    const response = await request(`/kb/${encodeURIComponent(kbName)}/documents`, {
      method: "POST",
      body: JSON.stringify({ text, ...options }),
    });
    return parseOrThrow<AddDocumentResult>(response, kbName);
  };

  const listDocuments = async (
    kbName: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DocumentSummary[]> => {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.offset !== undefined) query.set("offset", String(options.offset));
    const qs = query.size > 0 ? `?${query}` : "";
    const response = await request(`/kb/${encodeURIComponent(kbName)}/documents${qs}`);
    if (response.status === 404) return [];
    const body = await parseOrThrow<{ documents: DocumentSummary[] }>(response, kbName);
    return body.documents;
  };

  const getDocument = async (kbName: string, documentId: number): Promise<DocumentDetail> => {
    const response = await request(`/kb/${encodeURIComponent(kbName)}/documents/${documentId}`);
    return parseOrThrow<DocumentDetail>(response, kbName);
  };

  const updateDocument = async (
    kbName: string,
    documentId: number,
    options: { text?: string; metadata?: unknown },
  ): Promise<UpdateDocumentResult> => {
    const response = await request(`/kb/${encodeURIComponent(kbName)}/documents/${documentId}`, {
      method: "PUT",
      body: JSON.stringify(options),
    });
    return parseOrThrow<UpdateDocumentResult>(response, kbName);
  };

  const deleteDocument = async (kbName: string, documentId: number): Promise<void> => {
    const response = await request(`/kb/${encodeURIComponent(kbName)}/documents/${documentId}`, {
      method: "DELETE",
    });
    await parseOrThrow<{ deleted: boolean }>(response, kbName);
  };

  const searchKb = async (
    kbName: string,
    query: string,
    options: { topK?: number; filter?: Record<string, unknown>; maxDistance?: number } = {},
  ): Promise<SearchResult[]> => {
    const response = await request(`/kb/${encodeURIComponent(kbName)}/search`, {
      method: "POST",
      body: JSON.stringify({ query, ...options }),
    });
    if (response.status === 404) return [];
    const body = await parseOrThrow<{ results: SearchResult[] }>(response, kbName);
    return body.results;
  };

  return { listKbs, deleteKb, addDocument, listDocuments, getDocument, updateDocument, deleteDocument, searchKb };
};

export type KbClient = ReturnType<typeof createKbClient>;
