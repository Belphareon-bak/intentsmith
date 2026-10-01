// Resource ownership for the two existing project-app HTTP relay tiers.
// Closing the downstream also closes only its owned upstream request, and
// close() waits for all request/response close events and handlers to settle.
import http from 'node:http';

export function createOwnedProviderRelay(handle) {
  const exchanges = new Set();
  let closing = false, closePromise = null;
  const server = http.createServer((incoming, outgoing) => {
    let request = null, response = null, handlerDone = false, cancelled = false;
    let requestClosed = true, responseClosed = true, reportError = () => {};
    let resolveSettled;
    const settled = new Promise(resolve => { resolveSettled = resolve; });
    const finish = () => {
      if (handlerDone && requestClosed && responseClosed) {
        exchanges.delete(exchange);
        resolveSettled();
      }
    };
    const cancel = (error = new Error('downstream provider request closed')) => {
      if (cancelled) return;
      cancelled = true;
      reportError(error);
      response?.destroy();
      request?.destroy(error);
      incoming.destroy();
      outgoing.destroy();
      finish();
    };
    const exchange = { settled, cancel };
    exchanges.add(exchange); // Own the handler before its first asynchronous read.
    incoming.once('aborted', () => cancel());
    incoming.once('close', () => { if (!incoming.complete) cancel(); });
    outgoing.once('close', () => { if (!outgoing.writableFinished) cancel(); });
    const forward = (options, { payload, onResponse = () => {}, onError = () => {}, timeoutMs = 180_000 } = {}) => {
      if (closing || cancelled) throw new Error('provider relay is closing');
      if (request) throw new Error('provider exchange already forwarded');
      reportError = onError;
      requestClosed = false;
      try {
        request = http.request(options, upstream => {
          response = upstream;
          responseClosed = false;
          upstream.once('close', () => { responseClosed = true; finish(); });
          upstream.once('error', error => cancel(error));
          upstream.once('aborted', () => cancel(new Error('upstream provider response aborted')));
          if (cancelled || closing) { cancel(); upstream.destroy(); return; }
          try {
            onResponse(upstream);
            outgoing.writeHead(upstream.statusCode, upstream.headers);
            upstream.pipe(outgoing);
          } catch (error) { cancel(error); }
        });
      } catch (error) { requestClosed = true; throw error; }
      request.once('close', () => { requestClosed = true; finish(); });
      request.on('error', error => {
        onError(error);
        if (!outgoing.destroyed) {
          if (!outgoing.headersSent) outgoing.writeHead(502);
          outgoing.end();
        }
        incoming.destroy();
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error('bounded provider timeout')));
      if (payload === undefined) incoming.pipe(request);
      else request.end(payload);
    };
    if (closing) cancel(new Error('provider relay is closing'));
    Promise.resolve().then(() => {
      if (!cancelled) return handle(incoming, outgoing, forward);
    }).catch(error => {
      reportError(error);
      if (!outgoing.destroyed) {
        if (!outgoing.headersSent) outgoing.writeHead(403);
        outgoing.end();
      }
    }).finally(() => { handlerDone = true; finish(); });
  });
  return {
    server,
    get activeRequestCount() { return exchanges.size; },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const serverClosed = new Promise((resolve, reject) => server.close(error => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        }));
        for (const exchange of exchanges) exchange.cancel(new Error('owned provider relay cleanup'));
        server.closeAllConnections();
        await serverClosed;
        await Promise.all([...exchanges].map(exchange => exchange.settled));
        if (exchanges.size !== 0) throw new Error('owned provider requests did not settle');
        return { activeRequests: 0 };
      })();
      return closePromise;
    },
  };
}
