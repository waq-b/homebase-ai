import { getDb } from "./db.js";

export type TurnRole = "system" | "user" | "assistant";

export interface StoredTurn {
  role: TurnRole;
  content: string;
  createdAt: string;
}

/**
 * v2.3 — conversation memory, keyed by an opaque `conversationId` the calling
 * app generates/tracks. Homebase does no auth/ownership checking (consistent
 * with v1's no-auth stance): isolation is "different id -> different history,"
 * not access control. Apps are responsible for generating IDs that don't
 * collide across users/sessions if that matters to them.
 */
export const getConversationTurns = (conversationId: string): StoredTurn[] => {
  const rows = getDb()
    .prepare(
      "SELECT role, content, created_at as createdAt FROM memory_turns WHERE conversation_id = ? ORDER BY id ASC",
    )
    .all(conversationId) as { role: TurnRole; content: string; createdAt: string }[];
  return rows;
};

export const appendConversationTurn = (conversationId: string, role: TurnRole, content: string): void => {
  getDb()
    .prepare("INSERT INTO memory_turns (conversation_id, role, content) VALUES (?, ?, ?)")
    .run(conversationId, role, content);
};

/** Returns the number of turns cleared. */
export const clearConversation = (conversationId: string): number => {
  const result = getDb().prepare("DELETE FROM memory_turns WHERE conversation_id = ?").run(conversationId);
  return Number(result.changes);
};
