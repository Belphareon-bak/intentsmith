import fs from "fs";
import path from "path";

export function collectContext(
  { workspaceRoot } = {},
  goal = "",
  K = 15
) {
  const root = workspaceRoot
    ? path.resolve(workspaceRoot)
    : process.cwd();

  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const f of entries) {
      const p = path.join(dir, f);
      let stat;
      try {
        stat = fs.statSync(p);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (
          f.startsWith(".") ||
          f === "node_modules" ||
          f === "dist" ||
          f === "sandbox"
        ) {
          continue;
        }
        walk(p);
      } else {
        files.push(p);
      }
    }
  }

  walk(root);

  const words = goal.toLowerCase().split(/\s+/).filter(Boolean);

  return files
    .map(p => ({
      path: p,
      score: words.some(w => p.toLowerCase().includes(w)) ? 1 : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, K)
    .map(x => x.path);
}
