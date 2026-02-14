#!/bin/bash
# C3 IDE — Apply v7 Fixes (round 2)
# Fixes: DI decorators, onStart fallback, layout cache reset
set -e

IDE_DIR="${1:-.}"
EXT_DIR="$IDE_DIR/extensions"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔═══════════════════════════════════════════════╗"
echo "║  C3 IDE v7 Fix — Round 2                      ║"
echo "║  DI decorators + layout cache + onStart        ║"
echo "╚═══════════════════════════════════════════════╝"

if [ ! -d "$EXT_DIR" ]; then
  echo "❌ Extensions not found. Usage: ./apply-fixes.sh /path/to/c3-ide"
  exit 1
fi

# ═══ Step 1: Copy fixed JS files ═══
echo ""
echo "📝 Applying fixed widget modules..."

cp "$SCRIPT_DIR/c3-chat-panel/lib/browser/chat-panel-module.js" \
   "$EXT_DIR/c3-chat-panel/lib/browser/chat-panel-module.js"
echo "  ✓ chat-panel-module.js"

cp "$SCRIPT_DIR/c3-sidebar/lib/browser/sidebar-module.js" \
   "$EXT_DIR/c3-sidebar/lib/browser/sidebar-module.js"
echo "  ✓ sidebar-module.js"

cp "$SCRIPT_DIR/c3-agent-panel/lib/browser/agent-panel-module.js" \
   "$EXT_DIR/c3-agent-panel/lib/browser/agent-panel-module.js"
echo "  ✓ agent-panel-module.js"

cp "$SCRIPT_DIR/c3-status-widget/lib/browser/status-widget-module.js" \
   "$EXT_DIR/c3-status-widget/lib/browser/status-widget-module.js"
echo "  ✓ status-widget-module.js"

# ═══ Step 2: Reset Theia layout cache ═══
echo ""
echo "🗑️  Resetting Theia layout cache..."

# Electron stores layout in ~/.config/C3 Studio/ or equivalent
THEIA_STORAGE="$HOME/.config/C3 Studio"
if [ -d "$THEIA_STORAGE" ]; then
  echo "  Found: $THEIA_STORAGE"
  # Remove layout storage (keeps other settings like recent workspaces)
  rm -f "$THEIA_STORAGE/Local Storage/leveldb/"* 2>/dev/null && echo "  ✓ Cleared Local Storage" || true
  rm -rf "$THEIA_STORAGE/IndexedDB" 2>/dev/null && echo "  ✓ Cleared IndexedDB" || true
  rm -f "$THEIA_STORAGE/storage.json" 2>/dev/null && echo "  ✓ Cleared storage.json" || true
else
  echo "  Not found at: $THEIA_STORAGE"
  echo "  Trying alternative paths..."
  for alt in "$HOME/.config/c3-studio" "$HOME/.config/c3-ide-electron" "$HOME/.config/Electron"; do
    if [ -d "$alt" ]; then
      echo "  Found: $alt"
      rm -f "$alt/Local Storage/leveldb/"* 2>/dev/null && echo "  ✓ Cleared Local Storage" || true
      rm -rf "$alt/IndexedDB" 2>/dev/null && echo "  ✓ Cleared IndexedDB" || true
      break
    fi
  done
fi

# Also clear Theia's own recentworkspace.json to be safe
THEIA_DATA="$HOME/.theia"
if [ -d "$THEIA_DATA" ]; then
  rm -f "$THEIA_DATA/recentworkspace.json" 2>/dev/null
  echo "  ✓ Cleared .theia recent workspace"
fi

# ═══ Step 3: Clean build ═══
echo ""
echo "🔨 Clean and rebuild..."
echo "  Run these commands:"
echo ""
echo "  cd $IDE_DIR"
echo "  yarn clean"
echo "  yarn"
echo "  yarn build"
echo "  yarn start"
echo ""
echo "═══════════════════════════════════════════════"
echo "✅ Fixes applied! Now run yarn clean && yarn build && yarn start"
echo ""
echo "⚠️  If widgets still don't show, open DevTools (Ctrl+Shift+I)"
echo "   and run: localStorage.clear() — then restart the app."
echo "═══════════════════════════════════════════════"
