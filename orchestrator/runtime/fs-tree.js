import fs from "fs";
import path from "path";

const IGNORE = new Set(["node_modules", ".git", ".venv", "dist", "build"]);

export function buildTree(root, depth = 4, currentDepth = 0) {
  if (currentDepth > depth) return [];

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(e => !IGNORE.has(e.name))
    .map(e => {
      const full = path.join(root, e.name);
      if (e.isDirectory()) {
        return {
          type: "dir",
          name: e.name,
          children: buildTree(full, depth, currentDepth + 1)
        };
      }
      return { type: "file", name: e.name };
    });
}
