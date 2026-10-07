# Homebase Bar

A small macOS menu bar utility (Swift/SwiftUI, macOS only) that starts, stops and restarts a local Homebase dev server without a terminal, shows live status, and opens the API docs or dashboard. It is a separate Swift package nested in this repo; it only talks to Homebase over HTTP and spawns/kills the `npm run dev` process.

`ServiceController` is parameterized by `ManagedService` (see `ManagedService.swift`), so more services can be added with the same start/stop/health-poll shape. Only Homebase is configured.

## Configure

The app runs `npm run dev` in your Homebase checkout. By default it looks in `~/Projects/homebase`. Set `HOMEBASE_REPO` to use another path:

```bash
HOMEBASE_REPO=/path/to/homebase swift run
```

A double-clicked `.app` does not inherit shell variables. Either keep the checkout at the default path, or run `launchctl setenv HOMEBASE_REPO /path/to/homebase` before launching it.

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

Double-click to launch, or drag `build/HomebaseBar.app` into `/Applications`. No dock icon (`LSUIElement` in `Info.plist`); it only shows up in the menu bar.

## Notes

- The start command, health-check URL and "Open" URLs are hardcoded in `ManagedService.swift`.
- The service polls `GET /agents` every 5s. Status: green = running, yellow = starting, red = stopped. The menu bar icon shows the aggregate.
- Per-agent enable/disable is out of scope.
- Not covered by CI (CI runs on Linux); I build and run it locally.
