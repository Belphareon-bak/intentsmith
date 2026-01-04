import fs from "fs";
import Ajv from "ajv";
import { saveBuildRequest } from "./build-store.js";

const ajv = new Ajv();

const schema = JSON.parse(
  fs.readFileSync(
    new URL("./build-request.schema.json", import.meta.url),
    "utf-8"
  )
);

const validate = ajv.compile(schema);

export function handleBuildRequest(req, res) {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    try {
      const request = JSON.parse(body);

      const valid = validate(request);
      if (!valid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          error: "Invalid build request",
          details: validate.errors
        }));
      }

      const saved = saveBuildRequest(request);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "BUILD_REQUEST_FROZEN",
        buildId: saved.id
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message || err));
    }
  });
}
