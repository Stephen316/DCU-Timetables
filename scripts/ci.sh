#!/usr/bin/env bash
# The checks CI runs, runnable locally so a push is never the first time they run.
# .github/workflows/web.yml and mobile.yml call this same file, so a green run here means
# the same commands pass there.
#
#   scripts/ci.sh          # web, then mobile
#   scripts/ci.sh web      # production build of the console (type-checks every file)
#   scripts/ci.sh mobile   # the Expo app: type-check, lint, unit tests, and a full bundle
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

mobile() {
  mkdir -p "$logs"
  cd "$root/mobile"
  [ -d node_modules ] || npm ci
  npx tsc --noEmit
  npx eslint .
  npx jest --ci
  # Bundles every screen, the way a device build would: a missing module or a bad import
  # fails here rather than in EAS. Offline, so it never needs Expo's servers.
  EXPO_OFFLINE=1 npx expo export --platform web --output-dir "$logs/mobile-web" > "$logs/mobile-export.log" 2>&1 \
    || { tail -40 "$logs/mobile-export.log" >&2; return 1; }
  echo "mobile: bundle OK"
}

case "${1:-all}" in
  web) web ;;
  mobile) mobile ;;
  all) web; mobile ;;
  *) echo "usage: scripts/ci.sh [web|mobile|all]" >&2; exit 2 ;;
esac
