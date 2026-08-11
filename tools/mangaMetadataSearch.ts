import { tool } from "ai";
import { z } from "zod";

/**
 * Replaces webSearch for manga-search specifically (see the ticket this
 * closes): DuckDuckGo's Instant Answer API only has infobox-style topics and
 * isn't manga/anime-aware. Ticket was updated after live-testing three
 * keyless candidates for niche/obscure manhwa+manhua coverage specifically:
 * MangaDex (api.mangadex.org) had the strongest niche/indie coverage
 * (scanlation-community-driven catalog), so it's primary here; AniList is
 * the secondary fallback for whatever MangaDex misses. MangaUpdates was the
 * third candidate the ticket named but isn't wired in — AniList alone
 * covers the fallback case well enough to keep this simple; revisit if
 * MangaDex+AniList together still miss real queries in practice.
 *
 * webSearch.ts itself is untouched; other agents (researcher) keep using it.
 */

interface NormalizedResult {
  title: string;
  altTitles: string[];
  originCountry: string;
  genres: string[];
  status: "ongoing" | "completed" | "hiatus" | "unknown";
  synopsis: string;
  url: string;
}

/**
 * MangaDex and AniList use different status vocabularies (lowercase
 * "ongoing"/"hiatus"/... vs uppercase "RELEASING"/"FINISHED"/...) — normalized
 * here so the tool's contract is source-agnostic and manga-search's system
 * prompt doesn't need to know which backend answered.
 */
const normalizeStatus = (status: string | null | undefined): "ongoing" | "completed" | "hiatus" | "unknown" => {
  switch ((status ?? "").toLowerCase()) {
    case "ongoing":
    case "releasing":
      return "ongoing";
    case "completed":
    case "finished":
      return "completed";
    case "hiatus":
      return "hiatus";
    default:
      return "unknown";
  }
};

const stripHtml = (text: string | null | undefined): string =>
  (text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

// --- MangaDex (primary) ---

const MANGADEX_ENDPOINT = "https://api.mangadex.org/manga";

const LANGUAGE_TO_COUNTRY: Record<string, string> = { ja: "JP", ko: "KR", zh: "CN", "zh-hk": "CN" };

interface MangaDexEntry {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Record<string, string>[];
    description: Record<string, string>;
    originalLanguage: string;
    status: string;
    tags: { attributes: { name: Record<string, string>; group: string } }[];
  };
}

const firstLocalized = (titles: Record<string, string> | undefined): string | undefined =>
  titles ? (titles.en ?? Object.values(titles)[0]) : undefined;

const searchMangaDex = async (query: string, limit: number): Promise<NormalizedResult[]> => {
  const url = new URL(MANGADEX_ENDPOINT);
  url.searchParams.set("title", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.append("contentRating[]", "suggestive");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MangaDex search failed: ${res.status}`);
  const data = (await res.json()) as { data?: MangaDexEntry[] };

  return (data.data ?? []).map((entry) => {
    const attrs = entry.attributes;
    const title = firstLocalized(attrs.title) ?? query;
    const altTitles = (attrs.altTitles ?? [])
      .map((t) => firstLocalized(t))
      .filter((t): t is string => Boolean(t) && t !== title);
    const genres = attrs.tags
      .filter((t) => t.attributes.group === "genre")
      .map((t) => t.attributes.name.en)
      .filter((name): name is string => Boolean(name));

    return {
      title,
      altTitles,
      originCountry: LANGUAGE_TO_COUNTRY[attrs.originalLanguage] ?? "unknown",
      genres,
      status: normalizeStatus(attrs.status),
      synopsis: stripHtml(firstLocalized(attrs.description)),
      url: `https://mangadex.org/title/${entry.id}`,
    };
  });
};

// --- AniList (fallback) ---

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

const ANILIST_QUERY = `
  query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(search: $search, type: MANGA) {
        title { romaji english native }
        synonyms
        countryOfOrigin
        genres
        status
        siteUrl
        description(asHtml: false)
      }
    }
  }
`;

interface AniListMedia {
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[] | null;
  countryOfOrigin: string | null;
  genres: string[] | null;
  status: string | null;
  siteUrl: string | null;
  description: string | null;
}

const searchAniList = async (query: string, limit: number): Promise<NormalizedResult[]> => {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query, perPage: limit } }),
  });
  if (!res.ok) throw new Error(`AniList search failed: ${res.status}`);
  const data = (await res.json()) as { data?: { Page?: { media?: AniListMedia[] } } };

  return (data.data?.Page?.media ?? []).map((m) => {
    const title = m.title.english ?? m.title.romaji ?? m.title.native ?? query;
    const altTitles = [m.title.romaji, m.title.native, ...(m.synonyms ?? [])].filter(
      (t): t is string => Boolean(t) && t !== title,
    );
    return {
      title,
      altTitles,
      originCountry: m.countryOfOrigin ?? "unknown",
      genres: m.genres ?? [],
      status: normalizeStatus(m.status),
      synopsis: stripHtml(m.description),
      url: m.siteUrl ?? "",
    };
  });
};

export const mangaMetadataSearch = tool({
  description:
    "Searches for real, structured manga/manhwa/manhua metadata — title, alt titles, origin country, genres, status, synopsis, and a source URL. Tries MangaDex first (strongest niche/indie coverage); falls back to AniList if MangaDex has no results. Purpose-built for manga/anime lookups, unlike generic web search.",
  parameters: z.object({
    query: z.string().describe("The title or search term to look up"),
    limit: z.number().int().positive().max(10).optional().describe("Max results to return, default 5"),
  }),
  execute: async ({ query, limit }) => {
    const n = limit ?? 5;
    const primary = await searchMangaDex(query, n).catch(() => []);
    if (primary.length > 0) return primary;
    return searchAniList(query, n).catch(() => []);
  },
});
