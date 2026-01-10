#!/bin/bash
# C.3 Architect Mode - Initialize Project
# Usage: init-architect.sh <project-name>
# 
# Creates the .c3-architect structure in current directory

set -e

PROJECT_NAME=${1:-""}

if [ -z "$PROJECT_NAME" ]; then
    echo "Usage: init-architect.sh <project-name>"
    exit 1
fi

ARCHITECT_DIR=".c3-architect"

# Check if already initialized
if [ -d "$ARCHITECT_DIR" ]; then
    echo "⚠️  Project already initialized"
    echo "Remove $ARCHITECT_DIR to reinitialize"
    exit 1
fi

echo "🚀 Initializing C.3 Architect Mode for: $PROJECT_NAME"
echo ""

# Create directory structure
mkdir -p "$ARCHITECT_DIR/roadmap"
mkdir -p "$ARCHITECT_DIR/history"

echo "✅ Created directory structure"

# Create spec.md
cat > "$ARCHITECT_DIR/spec.md" << EOF
# $PROJECT_NAME

## Cíl

<!-- Co je hlavním cílem projektu? -->

## Scope

### Co projekt řeší

- 

### Co projekt neřeší

- 

## Technologie

- 

## Reference

<!-- Odkazy, inspirace, podobné projekty -->

## Poznámky

<!-- Další důležité informace -->
EOF
echo "✅ Created spec.md"

# Create state.json
TIMESTAMP=$(date -Iseconds)
cat > "$ARCHITECT_DIR/state.json" << EOF
{
  "project": "$PROJECT_NAME",
  "created": "$TIMESTAMP",
  "mode": "architect",
  "definitionConfidence": 0.0,
  "current": {
    "path": null,
    "status": "initializing",
    "started": "$TIMESTAMP"
  },
  "scopeLock": {
    "active": false,
    "path": null
  },
  "stats": {
    "total": 0,
    "done": 0,
    "wip": 0,
    "blocked": 0
  },
  "lastActivity": "$TIMESTAMP"
}
EOF
echo "✅ Created state.json"

# Create roadmap/main.md
cat > "$ARCHITECT_DIR/roadmap/main.md" << EOF
# Roadmap: $PROJECT_NAME

## Stav
Hotovo: 0/0 | WIP: 0 | Blocked: 0

## Struktura

<!-- Bloky budou přidány během plánování -->
EOF
echo "✅ Created roadmap/main.md"

# Initialize git if not already
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    git init
    echo "✅ Initialized git repository"
fi

# Initial commit
git add -A
if ! git diff --cached --quiet; then
    git commit -m "chore: initialize C.3 Architect Mode for $PROJECT_NAME"
    echo "✅ Initial commit"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🎉 Project initialized!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. Edit $ARCHITECT_DIR/spec.md to define your project"
echo "  2. Start the C.3 server and begin conversation"
echo "  3. AI will help you build the roadmap"
echo ""
