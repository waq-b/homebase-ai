# Memory (conversations)

Deep reference for conversation memory (`src/memory.ts`), added in v2.3. Flipped from "per-app package" to "Homebase service" for the same reason RAG was: same shape of problem (store + retrieve), avoids duplicating the logic in every app.

## Opting an invoke into memory

Add an optional `conversationId` to any `POST /agents/:name/invoke` body, alongside `input`:

```bash
curl localhost:3000/agents/summarizer/invoke \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"My favorite color is blue.","conversationId":"user-42-session-1"}'

curl localhost:3000/agents/summarizer/invoke \
  -X POST -H 'content-type: application/json' \
  -d '{"input":"What did I just tell you?","conversationId":"user-42-session-1"}'
# The second call "remembers" the first turn.
```

`conversationId` is generated/tracked entirely by the calling app — Homebase doesn't create or validate it beyond "non-empty string." It isn't part of each agent's declared input schema (that stays per-`input.type`); it's read directly off the raw request body in `src/invoke.ts` (`extractConversationId`), so it works identically regardless of an agent's `input.type` (`string`, `messages`, or `object`).

Works on both the plain and streaming (`?stream=true`) paths — streaming persists the turn once the stream completes (`onFinish`), same as tool-bearing agents' MCP cleanup.

## How it works

When `conversationId` is present, `prepare()` (`src/invoke.ts`) loads that conversation's prior turns from SQLite and prepends them to the message list, ahead of the new turn: `[system?, ...priorTurns, ...newTurn]`. After the model responds, the new turn(s) and the assistant's reply are appended back to storage.

If an agent has no `system` prompt and/or is invoked without `conversationId`, behavior is byte-for-byte identical to before v2.3 — this is purely additive.

## Reading and clearing raw history

```bash
curl localhost:3000/memory/user-42-session-1
# { "conversationId": "...", "turns": [{ "role": "user", "content": "...", "createdAt": "..." }, ...] }

curl -X DELETE localhost:3000/memory/user-42-session-1
# { "cleared": 4 }
```

Useful for app-side display or debugging — these two routes never touch the model, they're raw storage reads.

## Isolation

Isolation is **"different id → different history,"** not access control — there's no auth in v1 (matching Homebase's overall no-auth stance), so anyone who knows/guesses a `conversationId` can read or extend that conversation via these routes. Apps are responsible for generating IDs that don't collide or leak across users/sessions if that matters for their use case (e.g. don't use a guessable sequential id).

## Retention

Keeps every turn forever — no TTL/expiry in v1 (the ticket's own open question, resolved this way; revisit if storage growth becomes a problem). No summarization or truncation of long histories either — all prior turns for a `conversationId` are injected every time, so very long conversations will grow the prompt accordingly.

## Storage

`memory_turns` table in the same SQLite file as RAG (`data/homebase.db`, see `docs/rag.md`): `(id, conversation_id, role, content, created_at)`.
