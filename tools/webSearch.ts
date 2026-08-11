import { tool } from "ai";
import { z } from "zod";

/**
 * Example tool for the shared tools/ convention: one file per tool, each
 * exporting an AI SDK `tool()` definition that any agent's hooks.ts can import.
 */
export const webSearch = tool({
  description: "Searches the web via DuckDuckGo's Instant Answer API and returns a short summary.",
  parameters: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`DuckDuckGo search failed: ${res.status}`);
    const data = (await res.json()) as { Heading?: string; AbstractText?: string };

    return {
      heading: data.Heading || query,
      summary: data.AbstractText || "No instant answer available for this query.",
    };
  },
});
