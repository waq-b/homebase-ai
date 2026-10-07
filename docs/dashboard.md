# Dashboard

Deep reference for `public/dashboard/` — a static, no-build-step web UI served by Homebase itself at `GET /dashboard`. For quickstart, just start Homebase and open `http://localhost:3000/dashboard/` in a browser.

## Origin

The dashboard started from a design mockup. The mockup was a prototype that needed a custom runtime plus React and Babel loaded from a CDN, so I did not ship it as-is. I kept its visual system (`public/dashboard/styles.css`, plain CSS) and reimplemented the interactive behavior as vanilla JS (`public/dashboard/app.js`) wired to Homebase's real HTTP API instead of the mockup's fake in-memory data. No bundler, no framework, no CDN dependency for the app logic (the CSS's `@import` of Google Fonts is the only external asset).

## Two sections adapted from the mockup

The mockup assumed a richer API than Homebase exposes. Rather than fake data, these two sections were adapted to what is real:

- **Agents is read-only.** `GET /agents` returns only `{ name, description, input }`, not the model, system prompt, params or hooks path, and there is no create/update/delete-agent API (agent configs are hand-edited YAML files by design, see `docs/agents.md`). The Agents section lists what is real. It has a working "Try it" panel that calls `POST /agents/:name/invoke`.
- **"Logs & Errors" became "Memory."** The mockup's logs section was client-side mock data with no backing endpoint, and Homebase has no request-logging feature. I replaced it with conversation memory, which existed but had no way to list known conversation ids (`GET /memory/:conversationId` requires already knowing the id). See the next section.

## New endpoint: `GET /memory`

Added to back this dashboard's Memory panel. It lists every `conversationId` with at least one stored turn:

```bash
curl localhost:3000/memory
# { "conversations": [{ "conversationId": "...", "turnCount": 4, "lastActive": "2026-08-12 13:42:31" }, ...] }
```

Implemented in `src/memory.ts`'s `listConversations()`, ordered by most-recently-active first. Complements the existing per-conversation `GET /memory/:conversationId` and `DELETE /memory/:conversationId` (`docs/memory.md`).

## Serving

`src/server.ts`: `GET /dashboard` redirects to `GET /dashboard/`, which is served (along with `/dashboard/app.js`, `/dashboard/styles.css`) by `@hono/node-server`'s `serveStatic({ root: "./public" })` middleware — no separate dev server, no separate port. `public/` is checked into the repo (these are hand-written static assets, not build output).

## What each section does against the real API

| Section | Reads | Writes |
|---|---|---|
| Agents | `GET /agents` | `POST /agents/:name/invoke` (Try it) |
| Endpoints | static list (this doc + `docs/*.md`) | generic method/path/body console against any real route |
| Knowledge Bases | `GET /kb`, `GET /kb/:name/documents`, `POST /kb/:name/search` | `POST /kb/:name/documents` (add doc / create KB via its first doc), `DELETE /kb/:name/documents/:id`, `DELETE /kb/:name` |
| Memory | `GET /memory`, `GET /memory/:conversationId` | `DELETE /memory/:conversationId` |

Knowledge bases have no standalone "create empty KB" endpoint (see `docs/rag.md` — a KB is created by whichever call first writes a document to that name), so the dashboard's "New knowledge base" dialog asks for a name, embedding model, and a first document's text together, and creates the KB via that first `POST /kb/:name/documents` call.

## Auto-refresh

The sidebar's gateway status dot polls `GET /health` every 15s. Section data is fetched on nav (not polled) — reopen a section or repeat an action to see fresh state, consistent with the rest of Homebase having no push/websocket layer.
