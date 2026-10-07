import { describe, expect, it } from "vitest";
import { validateNotes } from "./meeting-notes.hooks.js";

const valid = {
  summary: "Agreed to ship on Friday.",
  decisions: ["Ship on Friday"],
  actionItems: [{ owner: "Sam", task: "Cut the release", due: null }],
};

describe("meeting-notes afterInvoke (validateNotes)", () => {
  it("returns well-formed notes as compact JSON", () => {
    expect(JSON.parse(validateNotes(JSON.stringify(valid, null, 2)))).toEqual(valid);
  });

  it("strips a code fence the model added around the JSON", () => {
    const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(JSON.parse(validateNotes(fenced))).toEqual(valid);
  });

  it("throws on JSON that does not match the contract", () => {
    expect(() => validateNotes(JSON.stringify({ summary: "x" }))).toThrow();
  });

  it("throws on output that is not JSON", () => {
    expect(() => validateNotes("Here are your notes!")).toThrow();
  });
});
