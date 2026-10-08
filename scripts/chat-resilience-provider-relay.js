// Private provider capture for the isolated chat runner. Every request and
// response chunk is fsynced before it can be forwarded to the child.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export function createChatResilienceProviderRelay({ out, upstream, model, models = [model], wire, persistWire, beforeForward }) {
  const allowedModels = new Set(models);
  const journal = fs.openSync(path.join(out, 'initial-provider-raw.jsonl'), 'wx', 0o600);
  const active = new Set();
  let sequence = 0;
  let journalClosed = false;
  const timings = new Map();
  const append = event => {
    const began = performance.now();
    const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const written = fs.writeSync(journal, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error('PROVIDER_RAW_JOURNAL_WRITE_FAILED');
      offset += written;
    }
    fs.fsyncSync(journal);
    const timing = timings.get(event.requestId);
    if (timing) timing.journalMs += performance.now() - began;
  };
  const proxy = http.createServer(async (request, response) => {
    const row = { requestId: ++sequence, at: new Date().toISOString(),
      caseId: request.headers['x-chat-measurement-case'] || 'boot',
      path: request.url, method: request.method, captureComplete: false,
      timing: { journalMs: 0, snapshotMs: 0 } };
    const began = performance.now();
    timings.set(row.requestId, row.timing);
    const persist = () => {
      const started = performance.now();
      persistWire(wire);
      row.timing.snapshotMs += performance.now() - started;
    };
    const state = { request, response, upstream: null, providerResponse: null,
      upstreamEnded: false, responseBytes: 0, ended: false };
    wire.push(row);
    active.add(state);
    append({ requestId: row.requestId, event: 'request_start', at: row.at,
      path: row.path, method: row.method, caseId: row.caseId });
    persist();
    const finishError = (reason, status = 502) => {
      if (state.ended) return;
      state.ended = true;
      row.error = reason;
      row.elapsedMs = Date.now() - Date.parse(row.at);
      append({ requestId: row.requestId, event: 'incomplete', at: new Date().toISOString(), reason });
      persist();
      active.delete(state);
      timings.delete(row.requestId);
      state.providerResponse?.destroy();
      state.upstream?.destroy();
      if (!response.destroyed) {
        if (!response.headersSent) response.writeHead(status);
        response.end(reason);
      }
    };
    state.finishError = finishError;
    response.on('error', error => finishError(`CHILD_RESPONSE_ERROR: ${error.message}`));
    response.on('close', () => {
      if (response.writableFinished || state.ended) return;
      finishError('CHILD_RESPONSE_CLOSED');
    });
    response.on('finish', () => {
      if (state.ended) return;
      if (!state.upstreamEnded) { finishError('CHILD_RESPONSE_FINISHED_EARLY'); return; }
      state.ended = true;
      row.captureComplete = true;
      append({ requestId: row.requestId, event: 'response_end', bytes: state.responseBytes });
      persist();
      active.delete(state);
      timings.delete(row.requestId);
    });
    request.on('aborted', () => finishError('CHILD_REQUEST_ABORTED'));
    request.on('error', error => finishError(`CHILD_REQUEST_ERROR: ${error.message}`));
    try {
      const chunks = [];
      for await (const chunk of request) {
        if (state.ended) return;
        append({ requestId: row.requestId, event: 'request_chunk', base64: chunk.toString('base64') });
        chunks.push(chunk);
      }
      if (state.ended) return;
      const bytes = Buffer.concat(chunks);
      let body = null;
      try { body = bytes.length ? JSON.parse(bytes) : null; }
      catch (error) { finishError(`INVALID_PROVIDER_REQUEST_JSON: ${error.message}`, 403); return; }
      row.body = body;
      append({ requestId: row.requestId, event: 'request_end', bytes: bytes.length });
      persist();
      const allowed = (request.method === 'GET' && ['/api/tags', '/api/ps', '/api/version'].includes(request.url))
        || (request.method === 'POST' && ['/api/chat', '/api/generate', '/api/show'].includes(request.url)
          && allowedModels.has(body?.model || body?.name)
          && !(request.url === '/api/generate' && body?.keep_alive === 0));
      if (!allowed) { finishError('OUT_OF_SCOPE provider request', 403); return; }
      if (beforeForward) await beforeForward(row);
      row.timing.beforeUpstreamMs = performance.now() - began;
      const upstreamStarted = performance.now();
      state.upstream = http.request({ ...upstream, path: request.url, method: request.method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, providerResponse => {
        if (state.ended) { providerResponse.destroy(); return; }
        state.providerResponse = providerResponse;
        row.status = providerResponse.statusCode;
        append({ requestId: row.requestId, event: 'response_start', status: row.status,
          headers: providerResponse.headers });
        persist();
        response.writeHead(providerResponse.statusCode, providerResponse.headers);
        const returned = [];
        providerResponse.on('data', chunk => {
          if (state.ended) return;
          append({ requestId: row.requestId, event: 'response_chunk', base64: chunk.toString('base64') });
          returned.push(chunk);
          response.write(chunk);
        });
        providerResponse.on('end', () => {
          if (state.ended) return;
          const raw = Buffer.concat(returned).toString();
          try { row.response = JSON.parse(raw); }
          catch { row.responseLines = raw.trim().split('\n').map(line => {
            try { return JSON.parse(line); } catch { return { invalid: line }; }
          }); }
          row.elapsedMs = Date.now() - Date.parse(row.at);
          row.timing.upstreamWallMs = performance.now() - upstreamStarted;
          row.timing.diagnosticBeforeForwardMs = row.timing.journalMs + row.timing.snapshotMs;
          row.timing.untilForwardedEndMs = performance.now() - began;
          state.responseBytes = Buffer.byteLength(raw);
          state.upstreamEnded = true;
          try { response.end(); }
          catch (error) { finishError(`CHILD_RESPONSE_END_ERROR: ${error.message}`); }
        });
        providerResponse.on('aborted', () => finishError('UPSTREAM_RESPONSE_ABORTED'));
        providerResponse.on('error', error => finishError(`UPSTREAM_RESPONSE_ERROR: ${error.message}`));
        providerResponse.on('close', () => {
          if (!providerResponse.complete) finishError('UPSTREAM_RESPONSE_CLOSED');
        });
      });
      state.upstream.on('error', error => finishError(`UPSTREAM_REQUEST_ERROR: ${error.message}`));
      state.upstream.end(bytes);
    } catch (error) { finishError(`PROVIDER_RELAY_ERROR: ${error.message}`); }
  });
  proxy.sealPending = reason => {
    for (const state of [...active]) {
      state.finishError(reason);
      state.request.destroy();
    }
  };
  proxy.closeJournal = () => {
    if (journalClosed) return;
    journalClosed = true;
    fs.closeSync(journal);
  };
  return proxy;
}
