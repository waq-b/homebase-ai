import { describe, expect, it } from "vitest";
import { chunkText } from "./rag.js";

describe("chunkText", () => {
  it("returns an empty array for empty text", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only text", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns one chunk for a single short paragraph", () => {
    expect(chunkText("A short sentence.")).toEqual(["A short sentence."]);
  });

  it("keeps a paragraph exactly at the 800-char threshold as one chunk", () => {
    const paragraph = "a".repeat(800);
    expect(chunkText(paragraph)).toEqual([paragraph]);
  });

  it("splits a paragraph one character over the threshold into two chunks", () => {
    const paragraph = "a".repeat(801);
    const chunks = chunkText(paragraph);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(800);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks.join("")).toBe(paragraph);
  });

  it("splits on blank lines into separate paragraph chunks (paragraph-aware)", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    expect(chunkText(text)).toEqual(["Paragraph one.", "Paragraph two.", "Paragraph three."]);
  });

  it("treats a single newline as part of the same paragraph, not a split point", () => {
    const text = "Line one.\nLine two still the same paragraph.";
    expect(chunkText(text)).toEqual(["Line one.\nLine two still the same paragraph."]);
  });

  it("drops empty paragraphs from excess blank lines", () => {
    const text = "First.\n\n\n\nSecond.";
    expect(chunkText(text)).toEqual(["First.", "Second."]);
  });

  it("trims leading/trailing whitespace per paragraph", () => {
    const text = "  First.  \n\n  Second.  ";
    expect(chunkText(text)).toEqual(["First.", "Second."]);
  });

  it("a long paragraph among short ones only splits the long one", () => {
    const long = "b".repeat(1000);
    const text = `Short one.\n\n${long}\n\nShort two.`;
    const chunks = chunkText(text);
    expect(chunks[0]).toBe("Short one.");
    expect(chunks[chunks.length - 1]).toBe("Short two.");
    expect(chunks).toHaveLength(4); // short + 2 pieces of the long one + short
  });
});
