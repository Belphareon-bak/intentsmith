import fs from "fs";
import yaml from "yaml";
import { validateConfig } from "./schema.js";

export function loadConfig(path) {
  const raw = fs.readFileSync(path, "utf8");
  const cfg = yaml.parse(raw);
  validateConfig(cfg);
  return cfg;
}
