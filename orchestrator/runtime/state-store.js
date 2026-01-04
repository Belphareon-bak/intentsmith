import fs from "node:fs";
import path from "node:path";

const stateFile = path.resolve("./sandbox/state.json");
const tmpFile = path.resolve("./sandbox/state.tmp.json");

export function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, stateFile);
}

export function loadState() {
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return null;
  }
}

export function clearState() {
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
}
