import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "audit");
const LOG_FILE = path.join(LOG_DIR, "audit.log");
const METRICS_FILE = path.join(LOG_DIR, "metrics.log");

function ensure() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function audit(event) {
  ensure();
  fs.appendFileSync(
    LOG_FILE,
    JSON.stringify({ ts: Date.now(), ...event }) + "\n"
  );
}

export function logMetrics(metrics) {
  ensure();
  fs.appendFileSync(
    METRICS_FILE,
    JSON.stringify({ ts: Date.now(), ...metrics }) + "\n"
  );
}
