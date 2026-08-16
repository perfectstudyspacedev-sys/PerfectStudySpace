#!/usr/bin/env bash
# TeammateIdle: runs when a teammate is about to go idle.
# Exit 2 = send feedback and KEEP the teammate working. Exit 0 = allow idle.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|go|rs|sql)$' || true)
[ -z "$CHANGED" ] && exit 0

FEEDBACK=""

if [ -f package.json ] && grep -q '"typecheck"' package.json; then
  if ! npm run typecheck --silent >/tmp/tc.log 2>&1; then
    FEEDBACK="${FEEDBACK}Typecheck is failing. Fix before going idle:\n$(tail -20 /tmp/tc.log)\n"
  fi
fi

if [ -f pyproject.toml ]; then
  if ! ruff check . >/tmp/ruff.log 2>&1; then
    FEEDBACK="${FEEDBACK}Ruff reports lint errors. Fix before going idle:\n$(tail -20 /tmp/ruff.log)\n"
  fi
fi

if [ -n "$FEEDBACK" ]; then
  echo -e "$FEEDBACK" >&2
  exit 2
fi
exit 0
