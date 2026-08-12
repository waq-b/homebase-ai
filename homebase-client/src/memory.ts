import { HomebaseMemoryError } from "./errors.js";

type Requester = (path: string, init?: RequestInit) => Promise<Response>;

export interface ConversationSummary {
  conversationId: string;
  turnCount: number;
  lastActive: string;
}

export interface StoredTurn {
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
}

/** Client for Homebase's conversation-memory endpoints (`/memory`, `/memory/:conversationId`) — raw read/clear only; writing happens as a side effect of `invokeAgent` with a `conversationId`. */
export const createMemoryClient = (request: Requester) => {
  const parseOrThrow = async <T>(response: Response, conversationId: string): Promise<T> => {
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HomebaseMemoryError(conversationId, response.status, body);
    }
    return (await response.json()) as T;
  };

  const listConversations = async (): Promise<ConversationSummary[]> => {
    const response = await request("/memory");
    const body = await parseOrThrow<{ conversations: ConversationSummary[] }>(response, "*");
    return body.conversations;
  };

  const getConversation = async (conversationId: string): Promise<StoredTurn[]> => {
    const response = await request(`/memory/${encodeURIComponent(conversationId)}`);
    const body = await parseOrThrow<{ turns: StoredTurn[] }>(response, conversationId);
    return body.turns;
  };

  const clearConversation = async (conversationId: string): Promise<number> => {
    const response = await request(`/memory/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
    const body = await parseOrThrow<{ cleared: number }>(response, conversationId);
    return body.cleared;
  };

  return { listConversations, getConversation, clearConversation };
};

export type MemoryClient = ReturnType<typeof createMemoryClient>;
