#!/bin/bash
# Copy CSS files from src/ to lib/ (tsc doesn't copy non-TS files)
count=0
for css in $(find "$(dirname "$0")"/c3-*/src -name "*.css" 2>/dev/null); do
  target="${css/src\//lib\/}"
  mkdir -p "$(dirname "$target")"
  cp "$css" "$target"
  count=$((count + 1))
done
echo "Copied $count CSS files to lib/"
