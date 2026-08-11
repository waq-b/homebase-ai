import type { InvokeContext } from "../src/hooks.js";

interface RankedCandidate {
  title?: unknown;
  [key: string]: unknown;
}

/**
 * Deterministic backstop for the reading-list exclusion ticket: qwen2.5:14b
 * doesn't reliably comply with "never include a candidate already in
 * readingList" from prompting alone (reproduced 0/8 across two different
 * prompt strategies — see the ticket). Rather than keep chasing prompt
 * wording, afterInvoke strips any readingList match out of the model's
 * output after the fact — the model still does the actual ranking/scoring
 * (it's fine at that part), this just guarantees the hard constraint holds
 * regardless of what the model does. ctx.input carries the original request
 * body (see src/invoke.ts) so readingList is available here.
 */
const filterReadingListMatches = (output: string, ctx: InvokeContext): string => {
  const input = ctx.input as { readingList?: { title?: unknown }[] } | undefined;
  const readingTitles = new Set(
    (input?.readingList ?? [])
      .map((entry) => (typeof entry.title === "string" ? entry.title.toLowerCase() : undefined))
      .filter((title): title is string => Boolean(title)),
  );
  if (readingTitles.size === 0) return output;

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return output; // not valid JSON — leave as-is, nothing safe to do here
  }
  if (!Array.isArray(parsed)) return output;

  const filtered = (parsed as RankedCandidate[]).filter((entry) => {
    const title = typeof entry.title === "string" ? entry.title.toLowerCase() : "";
    return !readingTitles.has(title);
  });

  return JSON.stringify(filtered);
};

export default {
  afterInvoke: filterReadingListMatches,
};
