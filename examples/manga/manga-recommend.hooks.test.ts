import { describe, expect, it } from "vitest";
import type { InvokeContext } from "../../src/hooks.js";
import hooks from "./manga-recommend.hooks.js";

const ctx = (readingList: { title: string }[]): InvokeContext =>
  ({ input: { readingList } }) as InvokeContext;

describe("manga-recommend afterInvoke (filterReadingListMatches)", () => {
  it("strips a candidate whose title matches the reading list, case-insensitively", () => {
    const output = JSON.stringify([
      { title: "Solo Leveling", score: 9 },
      { title: "SOLO LEVELING", score: 8 },
      { title: "Omniscient Reader's Viewpoint", score: 7 },
    ]);

    const result = hooks.afterInvoke!(output, ctx([{ title: "solo leveling" }]));

    expect(JSON.parse(result)).toEqual([{ title: "Omniscient Reader's Viewpoint", score: 7 }]);
  });

  it("passes non-JSON output through unchanged", () => {
    const result = hooks.afterInvoke!("not json at all", ctx([{ title: "solo leveling" }]));
    expect(result).toBe("not json at all");
  });

  it("passes a non-array JSON payload through unchanged", () => {
    const output = JSON.stringify({ note: "unexpected shape" });
    const result = hooks.afterInvoke!(output, ctx([{ title: "solo leveling" }]));
    expect(result).toBe(output);
  });

  it("returns output unchanged when the reading list is empty", () => {
    const output = JSON.stringify([{ title: "Solo Leveling", score: 9 }]);
    const result = hooks.afterInvoke!(output, ctx([]));
    expect(result).toBe(output);
  });
});
