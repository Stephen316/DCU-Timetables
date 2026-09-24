#!/usr/bin/env bash
# The checks CI runs, runnable locally so a push is never the first time they run.
# .github/workflows/web.yml and ios.yml call this same file, so a green run here means
# the same commands pass there.
#
#   scripts/ci.sh          # web, then ios
#   scripts/ci.sh web      # production build of the console (type-checks every file)
#   scripts/ci.sh ios      # xcodegen, then build and run the unit tests on a simulator
#
# SIMULATOR=<device name> overrides the iPhone the tests run on.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
logs="$root/build/ci"

web() {
  cd "$root/web"
  [ -d node_modules ] || npm ci
  # next build and next dev share web/.next; building under a running dev server leaves
  # it serving a half-replaced tree.
  if [ -z "${CI:-}" ] && lsof -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "web: stop the dev server on :3100 first — it shares web/.next with next build" >&2
    return 1
  fi
  npm run build
}

ios() {
  cd "$root"
  mkdir -p "$logs"
  xcodegen generate --quiet
  # The full log runs to tens of thousands of lines, so it goes to a file and only the
  # verdict is printed. Status is taken from xcodebuild itself, not from a pipe.
  local status=0
  xcodebuild -project DCUTimetable.xcodeproj -scheme DCUTimetable \
    -destination "platform=iOS Simulator,name=${SIMULATOR:-iPhone 17}" \
    -derivedDataPath build/DerivedData \
    test > "$logs/ios-test.log" 2>&1 || status=$?
  grep -E "error:|✘|Test run with|\*\* (BUILD|TEST) (SUCCEEDED|FAILED)" "$logs/ios-test.log" | tail -40 || true
  [ "$status" -eq 0 ] || echo "ios: xcodebuild exited $status — full log in build/ci/ios-test.log" >&2
  return "$status"
}

case "${1:-all}" in
  web) web ;;
  ios) ios ;;
  all) web; ios ;;
  *) echo "usage: scripts/ci.sh [web|ios|all]" >&2; exit 2 ;;
esac
