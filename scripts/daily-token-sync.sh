#!/bin/zsh
# Daily token-usage sync: regenerate assets/data/tokens.json from local
# Claude Code / Codex logs and push if anything changed.
# Scheduled by ~/Library/LaunchAgents/io.wannabeyourfriend.token-sync.plist,
# which fires at 12:00 and 13:00 Beijing time; the guard below lets only the
# run that lands on 12:00 A.M. US Eastern through (EST/EDT both handled).
set -euo pipefail
export PATH="/Users/admin/.nvm/versions/node/v22.17.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if [[ "${1:-}" != "--force" ]]; then
  [[ "$(TZ=America/New_York date +%H)" == "00" ]] || exit 0
fi

cd /Users/admin/Codebase/wannabeyourfriend.github.io
node scripts/update-tokens.mjs

if ! git diff --quiet -- assets/data/tokens.json; then
  git add assets/data/tokens.json
  git commit -m "Auto-sync token usage ($(date +%F))"
  git push origin main
  echo "$(date '+%F %T') pushed new tokens.json"
else
  echo "$(date '+%F %T') no change"
fi
