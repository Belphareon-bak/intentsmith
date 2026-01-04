import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";

const schemaPath = path.resolve(
  "./orchestrator/build/build-request.schema.json"
);

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

/**
 * Validate build request payload.
 * Throws error on invalid input.
 */
export function validateBuildRequest(data) {
  const ok = validate(data);
  if (!ok) {
    const msg = validate.errors
      .map(e => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error("Invalid build request: " + msg);
  }
  return true;
}

/**
 * Optional helper (kept for future use)
 */
export function saveBuildRequest(dir, buildId, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, buildId),
    JSON.stringify(data, null, 2)
  );
}
