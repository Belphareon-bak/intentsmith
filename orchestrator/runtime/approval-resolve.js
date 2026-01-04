import http from "http";
import { resumeExecution } from "./execution-controller.js";
import { clearApprovalState } from "./execution-state.js";

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/resolve") {
    clearApprovalState();
    await resumeExecution();
    res.writeHead(200);
    res.end("OK");
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3333, "127.0.0.1", () => {
  console.log("Approval resolve on 127.0.0.1:3333");
});
