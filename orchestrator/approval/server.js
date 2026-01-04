import http from "http";
import { approve } from "./plugin.js";

export function startApprovalServer(port = 3333) {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      return res.end();
    }

    if (req.method === "POST" && req.url === "/resolve") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        const { id, approved } = JSON.parse(body);
        approve(id, approved);
        res.writeHead(200);
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, "127.0.0.1", () => {
    console.log("Approval resolve on 127.0.0.1:" + port);
  });
}
