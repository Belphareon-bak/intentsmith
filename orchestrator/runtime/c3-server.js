import http from "http";
import { runC3 } from "./run-c3.js";

const PORT = 3335;

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        const { prompt } = JSON.parse(body);
        runC3(prompt, {
          sandbox: "./sandbox",
          workspaceRoot: "."
        });
        res.writeHead(200);
        res.end("OK");
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("C.3 run server on 127.0.0.1:" + PORT);
});
