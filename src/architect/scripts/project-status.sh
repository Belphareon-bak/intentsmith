#!/bin/bash
# C.3 Architect Mode - Project Status
# Usage: project-status.sh
# 
# Shows current project status from state.json and roadmap

set -e

ARCHITECT_DIR=".c3-architect"
STATE_FILE="$ARCHITECT_DIR/state.json"
ROADMAP_FILE="$ARCHITECT_DIR/roadmap/main.md"

# Check if architect dir exists
if [ ! -d "$ARCHITECT_DIR" ]; then
    echo "Error: .c3-architect directory not found"
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  C.3 Architect Mode - Project Status"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Read state.json
if [ -f "$STATE_FILE" ] && command -v jq &> /dev/null; then
    PROJECT=$(jq -r '.project // "unknown"' "$STATE_FILE")
    MODE=$(jq -r '.mode // "architect"' "$STATE_FILE")
    CONFIDENCE=$(jq -r '.definitionConfidence // 0' "$STATE_FILE")
    CURRENT_PATH=$(jq -r '.current.path // "none"' "$STATE_FILE")
    CURRENT_STATUS=$(jq -r '.current.status // "unknown"' "$STATE_FILE")
    TOTAL=$(jq -r '.stats.total // 0' "$STATE_FILE")
    DONE=$(jq -r '.stats.done // 0' "$STATE_FILE")
    WIP=$(jq -r '.stats.wip // 0' "$STATE_FILE")
    BLOCKED=$(jq -r '.stats.blocked // 0' "$STATE_FILE")
    HAS_BLOCKER=$(jq -r 'if .blocker then "yes" else "no" end' "$STATE_FILE")
    
    # Calculate progress
    if [ "$TOTAL" -gt 0 ]; then
        PROGRESS=$((DONE * 100 / TOTAL))
    else
        PROGRESS=0
    fi
    
    CONFIDENCE_PCT=$(echo "$CONFIDENCE * 100" | bc 2>/dev/null || echo "0")
    
    echo "📋 Project: $PROJECT"
    echo "🎯 Mode: $MODE"
    echo ""
    echo "📍 Current: $CURRENT_PATH ($CURRENT_STATUS)"
    echo "📊 Confidence: ${CONFIDENCE_PCT%.*}%"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Progress: $DONE/$TOTAL blocks ($PROGRESS%)"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  ✅ Done: $DONE"
    echo "  🔄 WIP: $WIP"
    echo "  ⚠️  Blocked: $BLOCKED"
    echo ""
    
    # Show blocker if present
    if [ "$HAS_BLOCKER" = "yes" ]; then
        echo "═══════════════════════════════════════════════════════════════"
        echo "  ⚠️  BLOCKER"
        echo "═══════════════════════════════════════════════════════════════"
        jq -r '.blocker | "  Type: \(.type)\n  Description: \(.description)\n  Next step: \(.nextStep // "none")"' "$STATE_FILE"
        echo ""
    fi
else
    echo "⚠️  Cannot read state.json (jq not installed or file missing)"
    echo ""
fi

# Show roadmap status line if available
if [ -f "$ROADMAP_FILE" ]; then
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Roadmap"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    # Show status line
    grep "^Hotovo:" "$ROADMAP_FILE" 2>/dev/null || echo "  (no status line)"
    echo ""
    # Count checkboxes
    DONE_COUNT=$(grep -c "\[x\]" "$ROADMAP_FILE" 2>/dev/null || echo "0")
    TODO_COUNT=$(grep -c "\[ \]" "$ROADMAP_FILE" 2>/dev/null || echo "0")
    echo "  Checkboxes: $DONE_COUNT done, $TODO_COUNT todo"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"

# Git status
if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
    LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "no commits")
    
    echo "  Git: $BRANCH ($CHANGES uncommitted changes)"
    echo "  Last: $LAST_COMMIT"
    echo "═══════════════════════════════════════════════════════════════"
fi
