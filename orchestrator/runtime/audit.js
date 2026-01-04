import fs from "node:fs";
import path from "node:path";

const auditDir = path.resolve("./sandbox/audit");
fs.mkdirSync(auditDir, { recursive: true });

export function audit(event) {
  const file = path.join(auditDir, `${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(event, null, 2));
}
