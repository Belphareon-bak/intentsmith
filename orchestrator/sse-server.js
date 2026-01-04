import http from "http";

const clients = new Set();

export function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  console.log("SSE BROADCAST", payload);
  for (const res of clients) {
    res.write(msg);
  }
}

export function startSSE(port = 3334) {
  const server = http.createServer((req, res) => {
    // === CORS – MUSÍ TAM BÝT VŠE ===
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Cache-Control"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url !== "/events") {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    res.write(": connected\n\n");
    clients.add(res);

    req.on("close", () => {
      clients.delete(res);
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`SSE listening on 127.0.0.1:${port}`);
  });
}
