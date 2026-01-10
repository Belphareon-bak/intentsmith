#!/bin/bash
# C.3 Architect Mode - Complete Block
# Usage: complete-block.sh <block-path>
# 
# Performs the complete sequence:
# 1. Mark block as done in roadmap/main.md
# 2. Update state.json
# 3. Git commit with conventional format

set -e

BLOCK_PATH=${1:-""}

if [ -z "$BLOCK_PATH" ]; then
    echo "Usage: complete-block.sh <block-path>"
    echo "Example: complete-block.sh 01-left-sidebar/02-navigation"
    exit 1
fi

ARCHITECT_DIR=".c3-architect"
ROADMAP_FILE="$ARCHITECT_DIR/roadmap/main.md"
STATE_FILE="$ARCHITECT_DIR/state.json"

# Check if architect dir exists
if [ ! -d "$ARCHITECT_DIR" ]; then
    echo "Error: .c3-architect directory not found"
    exit 1
fi

# Extract block name for commit
BLOCK_NAME=$(echo "$BLOCK_PATH" | sed 's|.*/||' | sed 's|^[0-9]*-||')
SCOPE=$(echo "$BLOCK_PATH" | cut -d'/' -f1 | sed 's|^[0-9]*-||')

TIMESTAMP=$(date -Iseconds)
SHORT_TIMESTAMP=$(date '+%Y-%m-%d %H:%M')

echo "📦 Completing block: $BLOCK_PATH"

# 1. Update roadmap/main.md - mark as done
if [ -f "$ROADMAP_FILE" ]; then
    # Replace [ ] with [x] for the block
    sed -i "s/\[ \] $BLOCK_PATH/[x] $BLOCK_PATH (→ $SHORT_TIMESTAMP)/" "$ROADMAP_FILE"
    echo "✅ Marked complete in roadmap"
fi

# 2. Update state.json
if [ -f "$STATE_FILE" ]; then
    # Use jq if available, otherwise simple sed
    if command -v jq &> /dev/null; then
        TMP_FILE=$(mktemp)
        jq --arg ts "$TIMESTAMP" '.current.status = "done" | .lastActivity = $ts | .stats.done += 1 | .stats.wip = (.stats.wip - 1 | if . < 0 then 0 else . end)' "$STATE_FILE" > "$TMP_FILE"
        mv "$TMP_FILE" "$STATE_FILE"
    else
        echo "Warning: jq not installed, state.json not updated"
    fi
    echo "✅ Updated state.json"
fi

# 3. Git commit
git add -A

if ! git diff --cached --quiet; then
    if [ -n "$BLOCK_NAME" ] && [ "$BLOCK_NAME" != "$SCOPE" ]; then
        COMMIT_MSG="feat($SCOPE): $BLOCK_NAME - complete"
    else
        COMMIT_MSG="feat: $SCOPE - complete"
    fi
    
    git commit -m "$COMMIT_MSG"
    echo "✅ Committed: $COMMIT_MSG"
else
    echo "ℹ️  No changes to commit"
fi

echo ""
echo "🎉 Block $BLOCK_PATH completed!"
