import http from "http";
import { approvalManager } from "./approval-manager.js";

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/approval/resolve") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const { id, approved } = JSON.parse(body);
      approvalManager.resolve(id, approved);
      res.end("OK");
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(3333, "127.0.0.1", () =>
  console.log("Approval server listening on 127.0.0.1:3333")
);
