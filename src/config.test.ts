import { describe, expect, it } from "vitest";
import { agentConfigSchema, inputPayloadSchema, type AgentConfig } from "./config.js";

describe("inputPayloadSchema — type: string", () => {
  const schema = inputPayloadSchema({ type: "string" });

  it("accepts a string input", () => {
    expect(schema.safeParse({ input: "hello" }).success).toBe(true);
  });

  it("rejects a non-string input", () => {
    expect(schema.safeParse({ input: 42 }).success).toBe(false);
  });
});

describe("inputPayloadSchema — type: messages", () => {
  const schema = inputPayloadSchema({ type: "messages" });

  it("accepts a valid message array", () => {
    const result = schema.safeParse({
      input: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid role", () => {
    const result = schema.safeParse({ input: [{ role: "narrator", content: "Hi" }] });
    expect(result.success).toBe(false);
  });

  it("rejects a message missing content", () => {
    const result = schema.safeParse({ input: [{ role: "user" }] });
    expect(result.success).toBe(false);
  });
});

describe("inputPayloadSchema — type: object, flat shorthand", () => {
  // Real shape from examples/manga/manga-search.yaml
  const schema = inputPayloadSchema({
    type: "object",
    shape: { query: "string", genre: "string", format: "string", limit: "number" },
  });

  it("accepts correctly-typed flat fields", () => {
    const result = schema.safeParse({ input: { query: "isekai", genre: "", format: "", limit: 10 } });
    expect(result.success).toBe(true);
  });

  it("rejects a wrong scalar type", () => {
    const result = schema.safeParse({ input: { query: "isekai", genre: "", format: "", limit: "ten" } });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = schema.safeParse({ input: { query: "isekai", genre: "", format: "" } });
    expect(result.success).toBe(false);
  });
});

describe("inputPayloadSchema — type: object, nullable field", () => {
  const schema = inputPayloadSchema({
    type: "object",
    shape: { rating: { type: "number", nullable: true } },
  });

  it("accepts the base type", () => {
    expect(schema.safeParse({ input: { rating: 8 } }).success).toBe(true);
  });

  it("accepts null", () => {
    expect(schema.safeParse({ input: { rating: null } }).success).toBe(true);
  });

  it("rejects a type that's neither the base type nor null", () => {
    expect(schema.safeParse({ input: { rating: "eight" } }).success).toBe(false);
  });

  it("rejects a missing field (nullable isn't the same as optional)", () => {
    expect(schema.safeParse({ input: {} }).success).toBe(false);
  });
});

describe("inputPayloadSchema — type: object, nested object field", () => {
  const schema = inputPayloadSchema({
    type: "object",
    shape: {
      preferences: {
        type: "object",
        shape: {
          favoriteGenres: { type: "array", items: "string" },
          notes: { type: "string", nullable: true },
        },
      },
    },
  });

  it("accepts a correctly-shaped nested object", () => {
    const result = schema.safeParse({
      input: { preferences: { favoriteGenres: ["action", "fantasy"], notes: null } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed nested input with a field-level issue, not a top-level crash", () => {
    const result = schema.safeParse({
      input: { preferences: { favoriteGenres: "action", notes: null } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["input", "preferences", "favoriteGenres"]);
    }
  });
});

describe("inputPayloadSchema — type: object, array-of-object field", () => {
  const schema = inputPayloadSchema({
    type: "object",
    shape: {
      readingList: {
        type: "array",
        items: {
          type: "object",
          shape: { title: "string", currentChapter: { type: "number", nullable: true } },
        },
      },
    },
  });

  it("accepts an array of correctly-shaped objects", () => {
    const result = schema.safeParse({
      input: { readingList: [{ title: "Solo Leveling", currentChapter: 179 }, { title: "ORV", currentChapter: null }] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects one malformed element among otherwise-valid ones", () => {
    const result = schema.safeParse({
      input: { readingList: [{ title: "Solo Leveling", currentChapter: 179 }, { title: 42, currentChapter: null }] },
    });
    expect(result.success).toBe(false);
  });
});

describe("inputPayloadSchema — deeply nested: array of object containing another array", () => {
  // Real shape from examples/manga/manga-recommend.yaml's `candidates` field.
  const schema = inputPayloadSchema({
    type: "object",
    shape: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          shape: {
            title: "string",
            genres: { type: "array", items: "string" },
          },
        },
      },
    },
  });

  it("accepts a valid deeply-nested payload", () => {
    const result = schema.safeParse({
      input: { candidates: [{ title: "Tower of God", genres: ["action", "adventure"] }] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a wrong type inside the innermost array", () => {
    const result = schema.safeParse({
      input: { candidates: [{ title: "Tower of God", genres: ["action", 123] }] },
    });
    expect(result.success).toBe(false);
  });
});

describe("inputPayloadSchema — real fixture: examples/manga/manga-recommend.yaml's full shape", () => {
  const shape: NonNullable<Extract<AgentConfig["input"], { type: "object" }>["shape"]> = {
    query: "string",
    candidates: {
      type: "array",
      items: {
        type: "object",
        shape: {
          title: "string",
          format: "string",
          genres: { type: "array", items: "string" },
          status: "string",
          synopsis: "string",
          sourceUrl: "string",
        },
      },
    },
    readingList: {
      type: "array",
      items: {
        type: "object",
        shape: {
          title: "string",
          status: "string",
          currentChapter: { type: "number", nullable: true },
          rating: { type: "number", nullable: true },
        },
      },
    },
    preferences: {
      type: "object",
      shape: {
        favoriteGenres: { type: "array", items: "string" },
        dislikedGenres: { type: "array", items: "string" },
        notes: { type: "string", nullable: true },
      },
    },
  };
  const schema = inputPayloadSchema({ type: "object", shape });

  it("accepts a real-shaped payload matching manga-recommend's actual contract", () => {
    const result = schema.safeParse({
      input: {
        query: "action manhwa",
        candidates: [
          {
            title: "Solo Leveling",
            format: "manhwa",
            genres: ["action", "fantasy"],
            status: "completed",
            synopsis: "...",
            sourceUrl: "https://example.com",
          },
        ],
        readingList: [{ title: "Vagabond", status: "reading", currentChapter: 5, rating: null }],
        preferences: { favoriteGenres: ["action"], dislikedGenres: [], notes: null },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when a required top-level field is missing", () => {
    const result = schema.safeParse({ input: { query: "x" } });
    expect(result.success).toBe(false);
  });
});

describe("agentConfigSchema — backward compatibility", () => {
  it("still accepts a minimal flat agent (string input, no hooks/mcpServers)", () => {
    const result = agentConfigSchema.safeParse({
      name: "summarizer",
      description: "Summarizes text",
      provider: "ollama",
      model: "llama3:latest",
      input: { type: "string" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown provider", () => {
    const result = agentConfigSchema.safeParse({
      name: "x",
      description: "x",
      provider: "anthropic",
      model: "claude",
      input: { type: "string" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional mcpServers", () => {
    const result = agentConfigSchema.safeParse({
      name: "x",
      description: "x",
      provider: "ollama",
      model: "llama3:latest",
      input: { type: "string" },
      mcpServers: [{ name: "demo", url: "http://localhost:8787/sse" }],
    });
    expect(result.success).toBe(true);
  });
});
