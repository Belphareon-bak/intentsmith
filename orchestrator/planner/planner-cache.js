import fs from "fs";
import crypto from "crypto";

const CACHE_FILE = ".planner-cache.json";

const cache = fs.existsSync(CACHE_FILE)
  ? JSON.parse(fs.readFileSync(CACHE_FILE))
  : {};

function key(goal, ctx) {
  return crypto.createHash("sha256")
    .update(goal + JSON.stringify(ctx))
    .digest("hex");
}

export function getCachedPlan(goal, ctx) {
  return cache[key(goal, ctx)];
}

export function saveCachedPlan(goal, ctx, plan) {
  cache[key(goal, ctx)] = plan;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
