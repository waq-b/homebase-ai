#!/bin/bash
# Builds a release binary and wraps it in a minimal .app bundle so it can be
# double-clicked / put in Applications, instead of only running via `swift run`.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

APP="build/HomebaseBar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cp .build/release/HomebaseBar "$APP/Contents/MacOS/HomebaseBar"
cp Info.plist "$APP/Contents/Info.plist"

echo "Built $APP"
