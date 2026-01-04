import http from "http";

const clients = new Set();

export function startApprovalEvents(port = 3334) {
  const server = http.createServer((req, res) => {
    if (req.url !== "/events") {
      res.writeHead(404);
      return res.end();
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    res.write(": connected\n\n");

    clients.add(res);

    req.on("close", () => {
      clients.delete(res);
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log("Approval SSE on 127.0.0.1:" + port);
  });
}

export function broadcast(payload) {
  const msg = "data: " + JSON.stringify(payload) + "\n\n";
  for (const res of clients) {
    res.write(msg);
  }
}
