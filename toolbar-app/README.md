# Homebase Bar

A macOS menu bar utility to control the Homebase server without a terminal — start/stop/restart, live status, and a shortcut to the docs UI. Separate Swift/SwiftUI project, nested in the Homebase repo for now.

No functional relationship to Homebase's code — this only talks to it over plain HTTP (`GET /agents`) and spawns/kills its `npm run dev` process.

## Run

```bash
swift run
```

## Build a release binary

```bash
swift build -c release
# binary at .build/release/HomebaseBar
```

## Notes

- The Homebase repo path is hardcoded in `HomebaseController.swift` for v1 (see the ticket — a settings screen can replace this later).
- Status polls `GET http://localhost:3000/agents` every 5s. Green = running, yellow = starting, red = stopped.
- Per-agent enable/disable and any Homebase API changes are explicitly out of scope for v1.
