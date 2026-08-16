#!/usr/bin/env bash
# TaskCompleted: runs when a task is being marked complete.
# Exit 2 = block completion and send feedback.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if git diff HEAD 2>/dev/null | grep -nE '^\+.*(console\.log|debugger;|breakpoint\(\)|TODO: ?FIXME)' >/tmp/debug.log; then
  echo -e "Debug residue found in the diff. Remove it before marking this task complete:\n$(head -15 /tmp/debug.log)" >&2
  exit 2
fi
exit 0
