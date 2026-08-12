import { describe, expect, it } from "vitest";
import { appendConversationTurn, clearConversation, listConversations } from "./memory.js";

describe("listConversations", () => {
  it("summarizes turn count and includes only conversations with stored turns", () => {
    const id = `test-list-conversations-${Date.now()}`;
    appendConversationTurn(id, "user", "hello");
    appendConversationTurn(id, "assistant", "hi there");

    const conversations = listConversations();
    const summary = conversations.find((c) => c.conversationId === id);

    expect(summary).toBeDefined();
    expect(summary?.turnCount).toBe(2);

    clearConversation(id);
    expect(listConversations().some((c) => c.conversationId === id)).toBe(false);
  });
});
