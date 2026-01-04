const clients = new Set();
const subscribers = new Set();

export function addClient(res) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

/**
 * Subscribe to events (for testing/internal use)
 * @param {Function} callback - Called with each event
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function emit(event) {
  // Notify SSE clients
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {}
  }
  
  // Notify internal subscribers
  for (const callback of subscribers) {
    try {
      callback(event);
    } catch (err) {
      console.error("Event subscriber error:", err);
    }
  }
}
