# Manga example agents

A real app built on Homebase: a manga and manhwa finder that calls these three agents. They are kept here as a worked example of a multi-agent app, not loaded by default.

| Agent | What it shows |
|---|---|
| `manga-search` | A domain-specific tool (`tools/mangaMetadataSearch.ts`) that queries MangaDex, AniList and MangaUpdates |
| `manga-recommend` | A deeply nested object input, and an `afterInvoke` hook that deterministically enforces a rule the model won't reliably follow (`manga-recommend.hooks.test.ts`) |
| `manga-log` | Parsing natural language into structured actions |

To run them, copy the `*.yaml` and `*.hooks.ts` files into `agents/` and the tool into `tools/`, then fix the two relative imports (`../src/hooks.js` and `./tools/mangaMetadataSearch.js`). The registry loads everything in `agents/`.
