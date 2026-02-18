#!/bin/bash

# C3 IDE - Tailwind CSS Setup Script
# Automatická instalace Tailwind CSS + dependencies

set -e

echo "🎨 C3 IDE - Tailwind CSS Setup"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: package.json not found!"
  echo "   Please run this script from the c3-ide root directory."
  exit 1
fi

echo "📦 Installing Tailwind CSS dependencies..."
echo ""

# Detect package manager
if command -v yarn &> /dev/null; then
  echo "Using yarn..."
  yarn add -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
elif command -v npm &> /dev/null; then
  echo "Using npm..."
  npm install -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
else
  echo "❌ Error: Neither npm nor yarn found!"
  echo "   Please install Node.js and npm/yarn first."
  exit 1
fi

echo ""
echo "✅ Dependencies installed successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Read INTEGRATION-GUIDE.md for integration instructions"
echo "   2. Build the project: yarn build (or npm run build)"
echo "   3. Start C3 IDE: yarn start (or npm start)"
echo ""
echo "📚 Documentation:"
echo "   - README-INTEGRATION.md - Overview"
echo "   - INTEGRATION-GUIDE.md - Detailed integration"
echo "   - VISUAL-PREVIEW.md - Design preview"
echo "   - START.md - Development guide"
echo ""
echo "🚀 Happy coding!"
