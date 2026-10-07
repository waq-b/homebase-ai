import { tool } from "ai";
import { z } from "zod";

/**
 * Replaces webSearch for manga-search specifically: DuckDuckGo's Instant
 * Answer API only has infobox-style topics and isn't manga/anime-aware.
 * Three sources, tried in order until one returns results:
 *   1. MangaDex — strongest niche/indie coverage, title-matched search.
 *   2. AniList — broader mainstream coverage, also title-matched.
 *   3. MangaUpdates — full-text search over descriptions, not just titles.
 *      This is what actually answers thematic/vibe queries ("villainess
 *      otome revenge") that MangaDex/AniList's title-only matching misses
 *      entirely — added after that gap was confirmed via direct API calls.
 *
 * webSearch.ts itself is untouched; other agents (researcher) keep using it.
 */

interface NormalizedResult {
  title: string;
  altTitles: string[];
  format: "manga" | "manhwa" | "manhua" | "unknown";
  genres: string[];
  status: "ongoing" | "completed" | "hiatus" | "unknown";
  synopsis: string;
  url: string;
  coverUrl: string | null;
}

/**
 * Each source describes format differently — MangaDex/AniList give an origin
 * language/country, MangaUpdates gives the format directly. Normalized here
 * (like status below) so manga-search's system prompt is source-agnostic and
 * doesn't need per-source mapping logic.
 */
const COUNTRY_TO_FORMAT: Record<string, NormalizedResult["format"]> = {
  JP: "manga",
  ja: "manga",
  KR: "manhwa",
  ko: "manhwa",
  CN: "manhua",
  zh: "manhua",
  "zh-hk": "manhua",
};

const normalizeFormat = (raw: string | null | undefined): NormalizedResult["format"] =>
  COUNTRY_TO_FORMAT[raw ?? ""] ?? "unknown";

/**
 * MangaDex and AniList use different status vocabularies (lowercase
 * "ongoing"/"hiatus"/... vs uppercase "RELEASING"/"FINISHED"/...); MangaUpdates'
 * search endpoint doesn't return a status at all. Normalized here so the
 * tool's contract is source-agnostic.
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

const SYNOPSIS_MAX_LENGTH = 500;

/**
 * Sources vary in how "clean" their descriptions are — MangaDex/AniList are
 * mostly plain text with occasional <br>, MangaUpdates descriptions are
 * often padded with markdown link lists (official translation sites, source
 * links) that add noise without recommendation-relevant information. All of
 * that gets stripped and the result capped — keeps the field useful and
 * keeps a local model's context (and therefore latency) from ballooning
 * across a multi-candidate response.
 */
const cleanSynopsis = (text: string | null | undefined): string => {
  const cleaned = (text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links -> just the link text
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > SYNOPSIS_MAX_LENGTH ? `${cleaned.slice(0, SYNOPSIS_MAX_LENGTH).trim()}…` : cleaned;
};

// --- MangaDex (primary) ---

const MANGADEX_ENDPOINT = "https://api.mangadex.org/manga";

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
  relationships: { type: string; attributes?: { fileName?: string } }[];
}

const firstLocalized = (titles: Record<string, string> | undefined): string | undefined =>
  titles ? (titles.en ?? Object.values(titles)[0]) : undefined;

const searchMangaDex = async (query: string, limit: number): Promise<NormalizedResult[]> => {
  const url = new URL(MANGADEX_ENDPOINT);
  url.searchParams.set("title", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.append("includes[]", "cover_art");
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
    const coverFileName = entry.relationships.find((r) => r.type === "cover_art")?.attributes?.fileName;

    return {
      title,
      altTitles,
      format: normalizeFormat(attrs.originalLanguage),
      genres,
      status: normalizeStatus(attrs.status),
      synopsis: cleanSynopsis(firstLocalized(attrs.description)),
      url: `https://mangadex.org/title/${entry.id}`,
      coverUrl: coverFileName ? `https://uploads.mangadex.org/covers/${entry.id}/${coverFileName}` : null,
    };
  });
};

// --- AniList (secondary) ---

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
        coverImage { large }
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
  coverImage: { large: string | null } | null;
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
      format: normalizeFormat(m.countryOfOrigin),
      genres: m.genres ?? [],
      status: normalizeStatus(m.status),
      synopsis: cleanSynopsis(m.description),
      url: m.siteUrl ?? "",
      coverUrl: m.coverImage?.large ?? null,
    };
  });
};

// --- MangaUpdates (tertiary — full-text description search, catches thematic/vibe queries) ---

const MANGAUPDATES_ENDPOINT = "https://api.mangaupdates.com/v1/series/search";

const MANGAUPDATES_FORMAT: Record<string, NormalizedResult["format"]> = {
  manga: "manga",
  manhwa: "manhwa",
  manhua: "manhua",
};

interface MangaUpdatesRecord {
  title: string;
  url: string;
  description: string | null;
  type: string;
  genres: { genre: string }[] | null;
  image: { url: { original: string | null } } | null;
}

// MangaUpdates has no content-rating filter on this endpoint (unlike MangaDex's
// contentRating[]), so explicit results are excluded here by genre tag instead —
// keeps this source's output at the same "safe/suggestive" bar as the other two.
const EXPLICIT_GENRES = new Set(["adult", "hentai", "smut", "gore"]);

const searchMangaUpdates = async (query: string, limit: number): Promise<NormalizedResult[]> => {
  const res = await fetch(MANGAUPDATES_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // NOTE: perpage/perPage is accepted by the API but silently ignored in
    // practice (confirmed empirically — always returns a fixed 25 regardless
    // of what's sent). Left in the request in case that changes; truncated
    // to `limit` client-side below either way.
    body: JSON.stringify({ search: query, perpage: limit }),
  });
  if (!res.ok) throw new Error(`MangaUpdates search failed: ${res.status}`);
  const data = (await res.json()) as { results?: { record: MangaUpdatesRecord }[] };

  // Only comics (manga-search's whole job) — MangaUpdates' catalog also
  // includes novels/artbooks/etc., which don't fit this agent's contract.
  return (data.results ?? [])
    .map((r) => r.record)
    .filter((record) => MANGAUPDATES_FORMAT[record.type.toLowerCase()])
    .filter((record) => !(record.genres ?? []).some((g) => EXPLICIT_GENRES.has(g.genre.toLowerCase())))
    .slice(0, limit)
    .map((record) => ({
      title: record.title,
      altTitles: [],
      format: MANGAUPDATES_FORMAT[record.type.toLowerCase()] ?? "unknown",
      genres: (record.genres ?? []).map((g) => g.genre),
      status: "unknown" as const, // MangaUpdates' search endpoint doesn't return a status field
      synopsis: cleanSynopsis(record.description),
      url: record.url,
      coverUrl: record.image?.url.original ?? null,
    }));
};

export const mangaMetadataSearch = tool({
  description:
    "Searches for real, structured manga/manhwa/manhua metadata — title, alt titles, format, genres, status, synopsis, source URL, and cover art. Tries MangaDex first (strongest niche/indie coverage), then AniList, then MangaUpdates (full-text search over descriptions — catches thematic/vibe queries the title-only sources miss). Purpose-built for manga/anime lookups, unlike generic web search.",
  parameters: z.object({
    query: z.string().describe("The title, or a thematic/vibe description, to look up"),
    limit: z.number().int().positive().max(10).optional().describe("Max results to return, default 5"),
  }),
  execute: async ({ query, limit }) => {
    // Small local models occasionally retry a failed search with an empty/
    // near-empty query string rather than giving up — MangaDex (and likely
    // the others) treat that as "no filter" and return generic popular
    // results instead of erroring, which would otherwise silently smuggle
    // irrelevant results past "never invent titles." Short-circuit instead.
    if (query.trim().length === 0) return [];

    const n = limit ?? 5;
    const mangaDexResults = await searchMangaDex(query, n).catch(() => []);
    if (mangaDexResults.length > 0) return mangaDexResults;

    const aniListResults = await searchAniList(query, n).catch(() => []);
    if (aniListResults.length > 0) return aniListResults;

    return searchMangaUpdates(query, n).catch(() => []);
  },
});
