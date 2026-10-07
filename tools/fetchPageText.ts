import { tool } from "ai";
import { z } from "zod";

const MAX_CHARS = 8000;

/** Crude HTML-to-text: strips script/style blocks, tags, and collapses whitespace. Good enough for simple pages — not a real readability extractor. */
const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Generic URL-to-text tool — no domain awareness, unlike the domain-specific tools in examples/. Used by
 * agents that should accept a URL instead of pasted text. Truncates long
 * pages (this is a safety cap against huge pages, not a precise limit).
 */
export const fetchPageText = tool({
  description: "Fetches a URL and returns its visible page text (HTML stripped), truncated to a safe length.",
  parameters: z.object({
    url: z.string().describe("The page URL to fetch"),
  }),
  execute: async ({ url }) => {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; HomebaseBot/1.0)" } });
    if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status}`);
    const html = await res.text();
    const text = stripHtml(html);
    return { url, text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text };
  },
});
