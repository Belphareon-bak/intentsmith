import { createServer as createHttpsServer } from 'node:https';
import { isIP } from 'node:net';

import {
  canonicalizeM7SessionValue,
} from './m7-session-authority-validation.js';
import {
  isGenuineM7DisconnectedRequestPipeline,
} from './m7-disconnected-request-pipeline.js';
import {
  assertM7VpnRuntimeConfigurationCurrent,
  isGenuineM7VpnRuntimeConfiguration,
  withM7ServiceCredentialMaterial,
} from './m7-vpn-runtime-config.js';

export const M7_VPN_TLS_LISTENER_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_VPN_TLS_LISTENER_ERROR = Object.freeze({
  ALREADY_ACTIVE: 'M7_VPN_LISTENER_ALREADY_ACTIVE',
  BIND_FAILED: 'M7_VPN_LISTENER_BIND_FAILED',
  CONFIG_INVALID: 'M7_VPN_LISTENER_CONFIG_INVALID',
  REQUEST_ABORTED: 'M7_VPN_LISTENER_REQUEST_ABORTED',
  REQUEST_TOO_LARGE: 'M7_VPN_LISTENER_REQUEST_TOO_LARGE',
});

const MAX_BODY_BYTES = 1_048_576;
const activePipelines = new WeakSet();
const listeners = new WeakSet();

export class M7VpnTlsListenerError extends Error {
  constructor(code, message) {
    super(`m7-vpn-listener:${message}`);
    this.name = 'M7VpnTlsListenerError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7VpnTlsListenerError(code, message);
}

function transportInput(request) {
  return {
    httpVersion: request.httpVersion,
    method: request.method,
    rawHeaders: [...request.rawHeaders],
    remoteAddress: request.socket.remoteAddress,
    socketEncrypted: request.socket.encrypted === true,
    target: request.url,
    tlsVersion: request.socket.getProtocol?.() ?? null,
  };
}

function declaredBodyTooLarge(rawHeaders) {
  if (!Array.isArray(rawHeaders)) return false;
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === 'content-length') {
      const value = rawHeaders[index + 1];
      return /^(?:0|[1-9][0-9]*)$/u.test(value) && Number(value) > MAX_BODY_BYTES;
    }
  }
  return false;
}

function responseStatus(error) {
  const code = error?.code || '';
  if (code === 'M7_DISCONNECTED_RATE_LIMITED') return 429;
  if (code === 'M7_VPN_LISTENER_REQUEST_TOO_LARGE' || code === 'M7_TRANSPORT_LIMIT_EXCEEDED') {
    return 413;
  }
  if (code === 'M7_SESSION_PAIRING_USED') return 409;
  if (code === 'M7_SESSION_PAIRING_EXPIRED' || code === 'M7_SESSION_PAIRING_REVOKED') return 410;
  if (code === 'M7_SESSION_PAIRING_INVALID') return 404;
  if (code.startsWith('M7_SESSION_')) return 401;
  if (code.startsWith('M7_TRANSPORT_')) return code.endsWith('PEER_DENIED') ? 403 : 400;
  if (code.startsWith('M7_DISCONNECTED_')) return 400;
  return 500;
}

function publicError(error) {
  const statusCode = responseStatus(error);
  const retryAfterSeconds = statusCode === 429
    && Number.isSafeInteger(error?.details?.retryAfterSeconds)
    && error.details.retryAfterSeconds > 0
    ? error.details.retryAfterSeconds
    : null;
  return {
    body: {
      code: statusCode === 500 ? 'REMOTE_INTERNAL_FAILURE' : error.code,
      contract: 'RemoteTransportError',
      retryAfterSeconds,
      version: 1,
    },
    retryAfterSeconds,
    statusCode,
  };
}

function writeCanonicalResponse(response, statusCode, body, retryAfterSeconds = null) {
  if (response.headersSent || response.destroyed) return;
  const bytes = Buffer.from(canonicalizeM7SessionValue(body), 'utf8');
  const headers = {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Length': String(bytes.length),
    'Content-Type': 'application/json; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (statusCode >= 400) headers.Connection = 'close';
  if (retryAfterSeconds !== null) headers['Retry-After'] = String(retryAfterSeconds);
  response.writeHead(statusCode, headers);
  response.end(bytes);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejectOnce(new M7VpnTlsListenerError(
          M7_VPN_TLS_LISTENER_ERROR.REQUEST_TOO_LARGE,
          'body-limit-exceeded',
        ));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, bytes));
    });
    request.once('aborted', () => rejectOnce(new M7VpnTlsListenerError(
      M7_VPN_TLS_LISTENER_ERROR.REQUEST_ABORTED,
      'request-aborted',
    )));
    request.once('error', rejectOnce);
  });
}

export function createM7VpnRequestHandler(pipeline, { isClosing = () => false } = {}) {
  if (!isGenuineM7DisconnectedRequestPipeline(pipeline) || typeof isClosing !== 'function') {
    fail(M7_VPN_TLS_LISTENER_ERROR.CONFIG_INVALID, 'genuine-pipeline-required');
  }
  return async (request, response) => {
    const destroyAfterResponse = () => {
      if (typeof response.once === 'function' && typeof request.destroy === 'function') {
        response.once('finish', () => request.destroy());
      }
    };
    if (isClosing()) {
      destroyAfterResponse();
      writeCanonicalResponse(response, 503, {
        code: 'REMOTE_LISTENER_DRAINING',
        contract: 'RemoteTransportError',
        retryAfterSeconds: null,
        version: 1,
      });
      return;
    }
    try {
      if (declaredBodyTooLarge(request.rawHeaders)) {
        fail(M7_VPN_TLS_LISTENER_ERROR.REQUEST_TOO_LARGE, 'declared-body-limit-exceeded');
      }
      const bodyBytes = await readBody(request);
      const result = await pipeline.dispatch({
        bodyBytes,
        transport: transportInput(request),
      });
      writeCanonicalResponse(response, 200, result);
    } catch (error) {
      if (error?.code === M7_VPN_TLS_LISTENER_ERROR.REQUEST_ABORTED || response.destroyed) return;
      const visible = publicError(error);
      destroyAfterResponse();
      writeCanonicalResponse(
        response, visible.statusCode, visible.body, visible.retryAfterSeconds,
      );
    }
  };
}

function tlsOptions(material) {
  return {
    cert: material.certificate,
    key: material.privateKey,
    maxHeaderSize: 8_192,
    maxVersion: 'TLSv1.3',
    minVersion: 'TLSv1.3',
    requestCert: false,
  };
}

function normalizedBoundAddress(value) {
  if (isIP(value) === 4) return value;
  if (isIP(value) === 6) return new URL(`https://[${value}]/`).hostname.slice(1, -1);
  return null;
}

function createFromMaterial(config, pipeline, material) {
  if (!isGenuineM7VpnRuntimeConfiguration(config)
    || !isGenuineM7DisconnectedRequestPipeline(pipeline)
    || activePipelines.has(pipeline)) {
    fail(M7_VPN_TLS_LISTENER_ERROR.CONFIG_INVALID, 'listener-authority-invalid');
  }
  let closing = false;
  let started = false;
  const sockets = new Set();
  const handler = createM7VpnRequestHandler(pipeline, { isClosing: () => closing });
  const server = createHttpsServer(tlsOptions(material), handler);
  if (!server || typeof server.listen !== 'function' || typeof server.close !== 'function') {
    fail(M7_VPN_TLS_LISTENER_ERROR.CONFIG_INVALID, 'https-server-invalid');
  }
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('tlsClientError', (_error, socket) => socket.destroy());

  const listener = Object.freeze({
    stage: M7_VPN_TLS_LISTENER_STAGE,
    async start() {
      if (!listeners.has(this) || started || closing) {
        return Promise.reject(new M7VpnTlsListenerError(
          M7_VPN_TLS_LISTENER_ERROR.ALREADY_ACTIVE,
          'start-state-invalid',
        ));
      }
      assertM7VpnRuntimeConfigurationCurrent(config);
      return new Promise((resolve, reject) => {
        const onError = error => {
          server.off('listening', onListening);
          reject(new M7VpnTlsListenerError(
            M7_VPN_TLS_LISTENER_ERROR.BIND_FAILED,
            error?.code || 'bind-failed',
          ));
        };
        const onListening = () => {
          server.off('error', onError);
          const address = server.address();
          if (!address || typeof address === 'string'
            || address.port !== 7443
            || normalizedBoundAddress(address.address)
              !== normalizedBoundAddress(config.bindAddress)) {
            server.close();
            reject(new M7VpnTlsListenerError(
              M7_VPN_TLS_LISTENER_ERROR.BIND_FAILED,
              'bound-address-mismatch',
            ));
            return;
          }
          started = true;
          resolve(Object.freeze({
            address: address.address,
            interfaceName: config.interfaceName,
            port: address.port,
            serverOrigin: config.serverOrigin,
          }));
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({
          backlog: 128,
          exclusive: true,
          host: config.bindAddress,
          ipv6Only: isIP(config.bindAddress) === 6,
          port: 7443,
        });
      });
    },
    stop({ graceMs = 5_000 } = {}) {
      if (!listeners.has(this)
        || !Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30_000) {
        return Promise.reject(new M7VpnTlsListenerError(
          M7_VPN_TLS_LISTENER_ERROR.CONFIG_INVALID,
          'stop-config-invalid',
        ));
      }
      closing = true;
      server.closeIdleConnections?.();
      if (!started) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
          server.closeAllConnections?.();
        }, graceMs);
        timer.unref?.();
        server.close(error => {
          clearTimeout(timer);
          started = false;
          if (error) reject(error);
          else resolve();
        });
      });
    },
  });
  activePipelines.add(pipeline);
  listeners.add(listener);
  return listener;
}

export function createM7VpnTlsListener({ config, pipeline } = {}) {
  return withM7ServiceCredentialMaterial(config, material => (
    createFromMaterial(config, pipeline, material)
  ));
}

export function isGenuineM7VpnTlsListener(value) {
  return listeners.has(value);
}

export const _testInternals = Object.freeze({
  declaredBodyTooLarge,
  publicError,
  responseStatus,
  tlsOptions,
  transportInput,
  writeCanonicalResponse,
});

export default createM7VpnTlsListener;
