#!/bin/bash
# C3 IDE — Extension Fix Script
# Fixes: inversify imports, missing lib files, build cache
set -e

IDE_DIR="${1:-.}"
EXT_DIR="$IDE_DIR/extensions"

echo "╔═══════════════════════════════════════════╗"
echo "║  C3 IDE Extension Fix                      ║"
echo "╚═══════════════════════════════════════════╝"
echo "Extensions dir: $EXT_DIR"

if [ ! -d "$EXT_DIR" ]; then
  echo "❌ Extensions not found at $EXT_DIR"
  echo "   Usage: ./fix-extensions.sh /path/to/c3-ide"
  exit 1
fi

# ═══════════════════════════════════════════════════
# FIX 1: Replace require("inversify") with correct path
# ═══════════════════════════════════════════════════
echo ""
echo "🔧 Fix 1: Correcting inversify imports..."
count=0
find "$EXT_DIR" -name "*.js" -path "*/lib/*" | while read f; do
  if grep -q 'require("inversify")' "$f" 2>/dev/null; then
    sed -i 's|require("inversify")|require("@theia/core/shared/inversify")|g' "$f"
    echo "  ✓ $(echo $f | sed "s|$EXT_DIR/||")"
    count=$((count+1))
  fi
done
echo "  Fixed all inversify imports"

# ═══════════════════════════════════════════════════
# FIX 2: Create missing lib/ files
# ═══════════════════════════════════════════════════
echo ""
echo "🔧 Fix 2: Creating missing lib files..."

STUB='\"use strict\";
Object.defineProperty(exports, \"__esModule\", { value: true });
const inversify_1 = require(\"@theia/core/shared/inversify\");
exports.default = new inversify_1.ContainerModule(() => {
  // Stub — will be replaced when extension TypeScript is compiled
});'

STUB_EXPORTS='\"use strict\";
Object.defineProperty(exports, \"__esModule\", { value: true });
// Stub exports — will be replaced when extension TypeScript is compiled'

# c3-protocol: lib/index.js (pure exports, no DI)
mkdir -p "$EXT_DIR/c3-protocol/lib"
cat > "$EXT_DIR/c3-protocol/lib/index.js" << 'EOF'
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// C3 Protocol — stub exports
exports.C3_BACKEND_PATH = '/services/c3-backend';
exports.C3_CHANNEL = 'c3-channel';
EOF
echo "  ✓ c3-protocol/lib/index.js"

# c3-release: lib/index.js (pure exports, no DI)
mkdir -p "$EXT_DIR/c3-release/lib"
cat > "$EXT_DIR/c3-release/lib/index.js" << 'EOF'
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// C3 Release — stub exports
EOF
echo "  ✓ c3-release/lib/index.js"

# c3-security-audit: lib/index.js (pure exports, no DI)
mkdir -p "$EXT_DIR/c3-security-audit/lib"
cat > "$EXT_DIR/c3-security-audit/lib/index.js" << 'EOF'
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// C3 Security Audit — stub exports
EOF
echo "  ✓ c3-security-audit/lib/index.js"

# c3-backend-bridge: lib/common/backend-bridge-protocol.js
mkdir -p "$EXT_DIR/c3-backend-bridge/lib/common"
cat > "$EXT_DIR/c3-backend-bridge/lib/common/backend-bridge-protocol.js" << 'EOF'
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// C3 Backend Bridge Protocol — stub
exports.C3BackendPath = '/services/c3-backend';
exports.C3BackendService = Symbol('C3BackendService');
EOF
echo "  ✓ c3-backend-bridge/lib/common/backend-bridge-protocol.js"

# ═══════════════════════════════════════════════════
# FIX 3: Ensure old c3-theme.css didn't delete chat-panel.css
# ═══════════════════════════════════════════════════
echo ""
echo "🔧 Fix 3: Verifying CSS files..."

CHAT_STYLES="$EXT_DIR/c3-chat-panel/lib/browser/styles"
if [ ! -f "$CHAT_STYLES/c3-chat.css" ]; then
  echo "  ⚠️  c3-chat.css missing — chat panel may not render correctly"
else
  echo "  ✓ c3-chat.css present ($(wc -l < "$CHAT_STYLES/c3-chat.css") lines)"
fi

if [ ! -f "$CHAT_STYLES/c3-theme.css" ]; then
  echo "  ⚠️  c3-theme.css missing — theme will not apply"
else
  echo "  ✓ c3-theme.css present ($(wc -l < "$CHAT_STYLES/c3-theme.css") lines)"
fi

AGENT_STYLES="$EXT_DIR/c3-agent-panel/lib/browser/styles"
if [ ! -f "$AGENT_STYLES/c3-agent-log.css" ]; then
  echo "  ⚠️  c3-agent-log.css missing"
else
  echo "  ✓ c3-agent-log.css present"
fi

# ═══════════════════════════════════════════════════
# FIX 4: Verify old chat-panel.css is not conflicting
# ═══════════════════════════════════════════════════
echo ""
echo "🔧 Fix 4: Removing conflicting old CSS..."
OLD_CHAT_CSS="$EXT_DIR/c3-chat-panel/lib/browser/styles/chat-panel.css"
if [ -f "$OLD_CHAT_CSS" ]; then
  echo "  ⚠️  Removing old chat-panel.css (conflicts with v7 c3-chat.css)"
  rm "$OLD_CHAT_CSS"
fi
OLD_CHAT_SRC="$EXT_DIR/c3-chat-panel/src/browser/styles/chat-panel.css"
if [ -f "$OLD_CHAT_SRC" ]; then
  rm "$OLD_CHAT_SRC"
  echo "  ✓ Removed old src chat-panel.css"
fi

OLD_AGENT_CSS="$EXT_DIR/c3-agent-panel/lib/browser/styles/agent-panel.css"
if [ -f "$OLD_AGENT_CSS" ]; then
  echo "  ⚠️  Removing old agent-panel.css"
  rm "$OLD_AGENT_CSS"
fi
OLD_AGENT_SRC="$EXT_DIR/c3-agent-panel/src/browser/styles/agent-panel.css"
if [ -f "$OLD_AGENT_SRC" ]; then
  rm "$OLD_AGENT_SRC"
  echo "  ✓ Removed old src agent-panel.css"
fi

OLD_STATUS_CSS="$EXT_DIR/c3-status-widget/lib/browser/styles/status-widget.css"
if [ -f "$OLD_STATUS_CSS" ]; then
  echo "  ⚠️  Removing old status-widget.css"
  rm "$OLD_STATUS_CSS"
fi

# ═══════════════════════════════════════════════════
# FIX 5: Remove c3-studio-main from build cache
# ═══════════════════════════════════════════════════
echo ""
echo "🔧 Fix 5: Checking for stale c3-studio-main references..."
stale=$(grep -r "c3-studio-main" "$EXT_DIR" --include="*.js" --include="*.css" -l 2>/dev/null || true)
if [ -n "$stale" ]; then
  echo "  ⚠️  Found stale c3-studio-main in:"
  echo "$stale" | while read f; do echo "    $f"; done
  echo "  These need to be cleaned with yarn clean"
else
  echo "  ✓ No stale c3-studio-main references"
fi

# ═══════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════"
echo "✅ All fixes applied!"
echo ""
echo "Next steps:"
echo "  cd $(realpath $IDE_DIR)"
echo "  yarn clean          # Clear build cache (CRITICAL)"
echo "  yarn                # Re-resolve dependencies"
echo "  yarn build          # Rebuild with fixed extensions"
echo "  yarn start          # Launch"
echo "═══════════════════════════════════════════════"
