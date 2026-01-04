import { startSSE } from "./sse-server.js";

// 🚀 jen spustíme SSE server
startSSE(3334);

// udržuj proces běžící
setInterval(() => {}, 1 << 30);
