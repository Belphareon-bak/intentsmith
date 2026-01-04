import http from "http";
import { addClient } from "./event-bus.js";

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    addClient(res);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3334, "127.0.0.1", () => {
  console.log("Approval SSE on 127.0.0.1:3334");
});
