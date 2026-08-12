import { afterEach, describe, expect, it } from "vitest";
import {
  addDocument,
  deleteDocument,
  deleteKb,
  DocumentNotFoundError,
  EmptyDocumentError,
  getDocument,
  KbModelMismatchError,
  KbNameCollisionError,
  KbNotFoundError,
  searchKb,
  updateDocument,
} from "./rag.js";

// Hits a real local Ollama instance for embeddings — see README's Testing
// section for why. Requires `ollama pull nomic-embed-text` and (for the
// model-override test) `ollama pull mxbai-embed-large`. Not run in CI.

const testKbs: string[] = [];
const freshKbName = (label: string) => {
  const name = `test-${label}-${Date.now()}`;
  testKbs.push(name);
  return name;
};

afterEach(() => {
  while (testKbs.length > 0) {
    const name = testKbs.pop()!;
    try {
      deleteKb(name);
    } catch {
      // KB may not have been created if the test failed before addDocument — fine to ignore.
    }
  }
});

describe("addDocument -> searchKb round-trip", () => {
  it("an added document is findable by a semantically related query", async () => {
    const kb = freshKbName("roundtrip");
    await addDocument(kb, "Solo Leveling is about Sung Jin-Woo, a weak hunter who becomes the strongest.");

    const results = await searchKb(kb, "strongest hunter leveling system");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Sung Jin-Woo");
    expect(results[0].chunkIndex).toBe(0);
  });

  it("multiple chunks from the same document are deduplicated to the best-scoring one", async () => {
    const kb = freshKbName("dedup");
    await addDocument(
      kb,
      "Solo Leveling is about Sung Jin-Woo, the weakest hunter.\n\n" +
        "Jin-Woo gains a mysterious leveling system after a near-death experience.\n\n" +
        "He becomes the strongest hunter in the world through this system.",
    );

    const results = await searchKb(kb, "Solo Leveling hunter leveling system", { topK: 5 });
    expect(results).toHaveLength(1);
  });

  it("searching a nonexistent KB throws KbNotFoundError", async () => {
    await expect(searchKb("test-does-not-exist", "anything")).rejects.toBeInstanceOf(KbNotFoundError);
  });
});

describe("updateDocument", () => {
  it("old content stops matching and new content matches after a text update", async () => {
    const kb = freshKbName("update");
    const { documentId } = await addDocument(kb, "The original synopsis about dragons and knights.");

    await updateDocument(kb, documentId, { text: "The completely rewritten synopsis about robots and space." });

    // Calibrated against real nomic-embed-text output for this exact pair (see
    // docs/rag.md's note on maxDistance being empirical, not a fixed Homebase
    // constant): the stale query lands ~1.1 (nothing left in the KB actually
    // matches it — its content was fully replaced), the fresh query ~0.75.
    const oldQuery = await searchKb(kb, "dragons and knights", { maxDistance: 0.9 });
    expect(oldQuery).toHaveLength(0);

    const newQuery = await searchKb(kb, "robots and space", { maxDistance: 0.9 });
    expect(newQuery).toHaveLength(1);
    expect(newQuery[0].content).toContain("robots and space");
  });

  it("a metadata-only update doesn't touch the indexed content", async () => {
    const kb = freshKbName("metadata-update");
    const { documentId } = await addDocument(kb, "Some searchable synopsis text.", {
      metadata: { title: "Original" },
    });

    await updateDocument(kb, documentId, { metadata: { title: "Renamed" } });

    const results = await searchKb(kb, "searchable synopsis");
    expect(results[0].content).toBe("Some searchable synopsis text.");
    expect(results[0].metadata).toEqual({ title: "Renamed" });
  });
});

describe("deleteDocument", () => {
  it("a deleted document's content stops matching, and search still works for the KB", async () => {
    const kb = freshKbName("delete");
    const { documentId } = await addDocument(kb, "A document about a very specific unique topic xylophone.");
    await addDocument(kb, "A second, unrelated document about cooking.");

    await deleteDocument(kb, documentId);

    const results = await searchKb(kb, "xylophone", { maxDistance: 0.5 });
    expect(results).toHaveLength(0);

    const stillWorks = await searchKb(kb, "cooking");
    expect(stillWorks).toHaveLength(1);
  });
});

describe("per-KB embedding model lock", () => {
  it("a second call to an existing KB with a different model is rejected", async () => {
    const kb = freshKbName("model-lock");
    await addDocument(kb, "First document, establishes the KB's model.");

    await expect(addDocument(kb, "Second document.", { model: "mxbai-embed-large" })).rejects.toBeInstanceOf(
      KbModelMismatchError,
    );
  });

  it("two KBs on different models coexist and both search correctly", async () => {
    const kbA = freshKbName("model-a");
    const kbB = freshKbName("model-b");

    await addDocument(kbA, "Content indexed with the default model.");
    await addDocument(kbB, "Content indexed with a different model.", { model: "mxbai-embed-large" });

    const resultsA = await searchKb(kbA, "default model");
    const resultsB = await searchKb(kbB, "different model");
    expect(resultsA).toHaveLength(1);
    expect(resultsB).toHaveLength(1);
  });
});

describe("getDocument", () => {
  it("returns the full rejoined content and metadata for a document", async () => {
    const kb = freshKbName("get-document");
    // Two short paragraphs — each stays under the chunking threshold, so the
    // rejoined content should come back byte-for-byte identical.
    const text = "First paragraph about dragons.\n\nSecond paragraph about knights.";
    const { documentId } = await addDocument(kb, text, { metadata: { title: "Test doc" } });

    const detail = await getDocument(kb, documentId);
    expect(detail.id).toBe(documentId);
    expect(detail.metadata).toEqual({ title: "Test doc" });
    expect(detail.content).toBe(text);
  });

  it("throws DocumentNotFoundError for an unknown document id in an existing KB", async () => {
    const kb = freshKbName("get-document-404");
    await addDocument(kb, "Some content to establish the KB.");
    expect(() => getDocument(kb, 999999)).toThrow(DocumentNotFoundError);
  });

  it("throws KbNotFoundError for an unknown KB", () => {
    expect(() => getDocument("test-does-not-exist", 1)).toThrow(KbNotFoundError);
  });
});

describe("whitespace-only text", () => {
  it("addDocument rejects with EmptyDocumentError, not a 502-mapped generic error", async () => {
    const kb = freshKbName("whitespace-add");
    await expect(addDocument(kb, "   \n\n  ")).rejects.toBeInstanceOf(EmptyDocumentError);
  });

  it("updateDocument rejects whitespace-only text without deleting the existing chunks", async () => {
    const kb = freshKbName("whitespace-update");
    const { documentId } = await addDocument(kb, "Original content that should survive a rejected update.");

    await expect(updateDocument(kb, documentId, { text: "   " })).rejects.toBeInstanceOf(EmptyDocumentError);

    const results = await searchKb(kb, "Original content survive");
    expect(results).toHaveLength(1);
  });
});

describe("KB name collision", () => {
  it("a name that sanitizes to an existing KB's vector table is rejected", async () => {
    const base = `test-collide-${Date.now()}`;
    testKbs.push(base, base.replace(/-/g, "_"));
    await addDocument(base, "First KB, establishes the vector table.");

    await expect(addDocument(base.replace(/-/g, "_"), "Second KB, same table name.")).rejects.toBeInstanceOf(
      KbNameCollisionError,
    );
  });
});

describe("metadata filter", () => {
  it("excludes a semantically closer result that fails the filter, keeps a matching one", async () => {
    const kb = freshKbName("filter");
    await addDocument(kb, "Solo Leveling: a weak hunter becomes the strongest through a leveling system.", {
      metadata: { genre: "action" },
    });
    await addDocument(kb, "Fruits Basket: a girl lives with a family cursed to turn into zodiac animals.", {
      metadata: { genre: "romance" },
    });

    const results = await searchKb(kb, "manga about family and curses", { filter: { genre: "romance" } });
    expect(results).toHaveLength(1);
    expect(results[0].metadata).toEqual({ genre: "romance" });
  });
});
