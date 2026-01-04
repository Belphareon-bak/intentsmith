import http from "http";
import { runC3 } from "./run-c3.js";
import { emit } from "./event-bus.js";

export function startHttpRunServer(port = 3335) {
  const server = http.createServer((req, res) => {

    if (req.method === "POST" && req.url === "/execute/plan") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", async () => {
        try {
          const { steps } = JSON.parse(body);
          if (!Array.isArray(steps)) {
            res.writeHead(400);
            return res.end("steps[] required");
          }

          // 🔴 execution vzniká TADY
          const { executionId } = await runC3({ steps });

          // ✅ teď je to pravda
          emit({ type: "execution_start", executionId });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ executionId }, null, 2));
        } catch (err) {
          res.writeHead(500);
          res.end(String(err.message || err));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`C.3 run server on 127.0.0.1:${port}`);
  });
}
