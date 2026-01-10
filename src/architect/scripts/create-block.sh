#!/bin/bash
# C.3 Architect Mode - Create Block
# Usage: create-block.sh <block-id> [parent-block]
# 
# Creates a new block with:
# - Folder in roadmap/
# - Definition .md file
# - Entry in main.md

set -e

BLOCK_ID=${1:-""}
PARENT=${2:-""}

if [ -z "$BLOCK_ID" ]; then
    echo "Usage: create-block.sh <block-id> [parent-block]"
    echo "Example: create-block.sh 01-left-sidebar"
    echo "Example: create-block.sh 01-history 01-left-sidebar"
    exit 1
fi

ARCHITECT_DIR=".c3-architect"
ROADMAP_DIR="$ARCHITECT_DIR/roadmap"
MAIN_FILE="$ROADMAP_DIR/main.md"

# Check if architect dir exists
if [ ! -d "$ARCHITECT_DIR" ]; then
    echo "Error: .c3-architect directory not found. Initialize project first."
    exit 1
fi

# Extract readable name
BLOCK_NAME=$(echo "$BLOCK_ID" | sed 's|^[0-9]*-||')

if [ -n "$PARENT" ]; then
    # Subblock
    BLOCK_DIR="$ROADMAP_DIR/$PARENT/$BLOCK_ID"
    BLOCK_PATH="$PARENT/$BLOCK_ID"
    INDENT="  "
else
    # Top-level block
    BLOCK_DIR="$ROADMAP_DIR/$BLOCK_ID"
    BLOCK_PATH="$BLOCK_ID"
    INDENT=""
fi

echo "📁 Creating block: $BLOCK_PATH"

# Create directory
mkdir -p "$BLOCK_DIR"
echo "✅ Created directory: $BLOCK_DIR"

# Create definition file
DEF_FILE="$BLOCK_DIR/$BLOCK_NAME.md"
cat > "$DEF_FILE" << EOF
# $BLOCK_NAME

## Cíl

<!-- Jaký je cíl tohoto bloku? -->

## Definice

<!-- Detailní popis - vzhled, chování, funkcionalita -->

## Závislosti

<!-- Na čem tento blok závisí? -->

## Poznámky

<!-- Další informace -->
EOF
echo "✅ Created definition: $DEF_FILE"

# Add to main.md
if [ -f "$MAIN_FILE" ]; then
    # Add entry before last line or at end of structure section
    if [ -n "$PARENT" ]; then
        # Find parent and add subblock under it
        # This is simplified - in practice, the orchestrator handles this better
        echo "${INDENT}- [ ] $BLOCK_ID" >> "$MAIN_FILE"
    else
        # Top-level block
        echo "- [ ] $BLOCK_ID" >> "$MAIN_FILE"
        echo "  - Cíl: " >> "$MAIN_FILE"
        echo "  - Hotovo když:" >> "$MAIN_FILE"
        echo "    - " >> "$MAIN_FILE"
    fi
    echo "✅ Added to main.md"
fi

echo ""
echo "📦 Block $BLOCK_PATH created!"
echo "Edit definition: $DEF_FILE"
