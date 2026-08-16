#!/usr/bin/env bash
# PreToolUse on Bash. Blocks execution of a COST-marked tool without acknowledgement.
# Exit 2 = block and send feedback to the agent. Exit 0 = allow.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

CMD=$(cat 2>/dev/null | grep -o '"command"[^,]*' | head -1)
[ -z "$CMD" ] && exit 0

# Only interested in invocations of scripts under tools/
echo "$CMD" | grep -qE 'tools/[a-zA-Z0-9_./-]+\.py' || exit 0

SCRIPT=$(echo "$CMD" | grep -oE 'tools/[a-zA-Z0-9_./-]+\.py' | head -1)
[ -f "$SCRIPT" ] || exit 0

# Read the COST: line from the module docstring
COST=$(head -20 "$SCRIPT" | grep -i '^COST:' | head -1)
[ -z "$COST" ] && exit 0
echo "$COST" | grep -qi 'free' && exit 0

# Cost-marked and not free — require explicit acknowledgement in the command
echo "$CMD" | grep -q 'COST_ACK=1' && exit 0

cat >&2 <<MSG
BLOCKED: $SCRIPT is cost-marked.
  $COST

Per .claude/rules/wat.md rule 3, ask the user before running or re-running a paid tool.
State the expected cost, get approval, then re-run prefixed with COST_ACK=1.
MSG
exit 2
