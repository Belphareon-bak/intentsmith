import http from "http";
import { applyEdit } from "../apply/apply.js";

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/apply") {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", async () => {
      const { filePath, content } = JSON.parse(body);
      await applyEdit(filePath, content);
      res.writeHead(200);
      res.end("ok");
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(7777, "127.0.0.1", () =>
  console.log("Apply server on 127.0.0.1:7777")
);
