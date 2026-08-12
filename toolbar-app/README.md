# Homebase Bar

A macOS menu bar utility to control local dev services without a terminal — start/stop/restart, live status, and a shortcut to open each one. Separate Swift/SwiftUI project, nested in the Homebase repo for now.

Manages three services, each independently (no dependency chaining — starting/stopping one never touches another): **Homebase**, **mangaFinder API**, and **mangaFinder Web** (its Vite dev server). No functional relationship to any of their code — this only talks to them over plain HTTP (a per-service health check) and spawns/kills each one's dev process.

Started as a Homebase-only tool; generalized into `ServiceController` (parameterized by `ManagedService`, see `ManagedService.swift`) once a second and third service needed the exact same start/stop/health-poll shape.

## Run

```bash
swift run
```

## Build a release binary

```bash
swift build -c release
# binary at .build/release/HomebaseBar
```

## Build an installable .app

```bash
./build-app.sh
# bundle at build/HomebaseBar.app
```

Double-click to launch, or drag `build/HomebaseBar.app` into `/Applications`. No dock icon (`LSUIElement` in `Info.plist`) — it only shows up in the menu bar.

## Notes

- Every service's repo path, start command, health-check URL, and "Open" URL are hardcoded in `ManagedService.swift` for v1 (a settings screen can replace this later — not planned).
- Each service polls its own health URL every 5s (Homebase: `GET /agents`; mangaFinder API: `GET /health`; mangaFinder Web: `GET /` since Vite has no JSON health endpoint, any `200` counts). Per-service status: green = running, yellow = starting, red = stopped. The toolbar icon shows an aggregate — green only if all three are up, red only if all three are down, yellow otherwise.
- Per-agent enable/disable and any service's own API changes are explicitly out of scope for v1.
- Assumes `mangaFinder` lives at `~/Projects/mangaFinder` (sibling to this repo) with a `web/` subdirectory for the Vite app — adjust `ManagedService.swift` if that ever moves.
