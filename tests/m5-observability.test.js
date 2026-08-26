#!/usr/bin/env node

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { suite, summary, test } from './harness.js';
import {
  FailureClass,
  HTTP_REQUEST_ID_HEADER,
  HTTP_RUN_ID_HEADER,
  PRODUCTION_DIAGNOSTICS_CONTRACT,
  classifyProductionFailure,
  createProductionObservability,
} from '../src/observability/production-observability.js';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.headersSent = false;
    this.statusCode = 200;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }
}

function loggerRecords() {
  const records = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (component, message, data) => records.push({ level, component, message, data });
  }
  return { logger, records };
}

function clock(start = Date.parse('2026-08-26T12:00:00.000Z')) {
  let now = start;
  return () => now++;
}

function complete(res, statusCode) {
  res.statusCode = statusCode;
  res.writableEnded = true;
  res.emit('finish');
}

suite('M5 production observability');

test('failure taxonomy is deterministic across transport and authority codes', () => {
  const cases = [
    [{ statusCode: 200 }, FailureClass.NONE, false],
    [{ statusCode: 401, errorCode: 'INTENTSMITH_AUTH_REQUIRED' }, FailureClass.AUTHENTICATION, false],
    [{ statusCode: 403, errorCode: 'INTENTSMITH_AUTH_SCOPE_REQUIRED' }, FailureClass.AUTHORIZATION, false],
    [{ statusCode: 400, errorCode: 'HTTP_BODY_INVALID_JSON' }, FailureClass.INPUT, false],
    [{ statusCode: 404, errorCode: 'HTTP_ROUTE_NOT_FOUND' }, FailureClass.NOT_FOUND, false],
    [{ statusCode: 409, errorCode: 'EXECUTION_RESULT_CONFLICT' }, FailureClass.CONFLICT, false],
    [{ statusCode: 429, errorCode: 'HTTP_RATE_LIMITED' }, FailureClass.RATE_LIMIT, true],
    [{ statusCode: 409, errorCode: 'PROJECT_CHANGE_TEST_CANCELLED' }, FailureClass.CANCELLED, false],
    [{ statusCode: 504, errorCode: 'PROCESS_TIMED_OUT' }, FailureClass.TIMEOUT, true],
    [{ statusCode: 503, errorCode: 'MODEL_PROVIDER_UNAVAILABLE' }, FailureClass.DEPENDENCY, true],
    [{ statusCode: 413, errorCode: 'HTTP_BODY_TOO_LARGE' }, FailureClass.RESOURCE, false],
    [{ statusCode: 503, errorCode: 'DATABASE_STORAGE_FAILURE' }, FailureClass.STORAGE, true],
    [{ statusCode: 503, errorCode: 'PROJECT_CHANGE_PROCESS_RECOVERY_UNRESOLVED' }, FailureClass.RECOVERY, true],
    [{ statusCode: 500, errorCode: 'HTTP_HANDLER_FAILED' }, FailureClass.INTERNAL, true],
  ];
  for (const [input, expectedClass, retryable] of cases) {
    const result = classifyProductionFailure(input);
    assert.equal(result.classification, expectedClass, JSON.stringify(input));
    assert.equal(result.retryable, retryable, JSON.stringify(input));
  }
});

test('HTTP completion correlates server request, client operation, lifecycle and durable run', () => {
  const { logger, records } = loggerRecords();
  const observability = createProductionObservability({
    logger,
    clock: clock(),
    idFactory: () => '00000000-0000-4000-8000-000000000001',
  });
  const req = { headers: { 'x-request-id': 'studio-request-7' } };
  const res = new FakeResponse();
  const request = observability.beginHttpRequest(req, res);
  request.setRoute('POST /api/m2/lifecycle/approve');
  request.setCredentialType('local-capability');
  observability.observeResponse(res, {
    statusCode: 200,
    payload: {
      requestId: 'operation-request-8',
      lifecycleId: 'lifecycle:9',
      plan: { identity: { runId: 'run:10' } },
    },
  });
  complete(res, 200);

  assert.equal(res.headers[HTTP_REQUEST_ID_HEADER.toLowerCase()], request.requestId);
  assert.equal(res.headers[HTTP_RUN_ID_HEADER.toLowerCase()], 'run:10');
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 'info');
  assert.deepEqual(records[0].data, {
    requestId: 'http:00000000-0000-4000-8000-000000000001',
    clientRequestId: 'studio-request-7',
    operationRequestId: 'operation-request-8',
    lifecycleId: 'lifecycle:9',
    runId: 'run:10',
    routeKey: 'POST /api/m2/lifecycle/approve',
    credentialType: 'local-capability',
    statusCode: 200,
    durationMs: 1,
    errorCode: null,
    failureClass: FailureClass.NONE,
    retryable: false,
  });
});

test('bounded failure ledger stores taxonomy but never arbitrary response payloads', () => {
  const { logger } = loggerRecords();
  let id = 0;
  const observability = createProductionObservability({
    logger,
    clock: clock(),
    idFactory: () => `request-${++id}`,
    recentFailureLimit: 2,
  });
  for (const code of ['HTTP_BODY_INVALID_JSON', 'HTTP_ROUTE_NOT_FOUND', 'HTTP_HANDLER_FAILED']) {
    const req = { headers: {} };
    const res = new FakeResponse();
    const request = observability.beginHttpRequest(req, res);
    request.setRoute('POST /bounded');
    observability.observeResponse(res, {
      statusCode: code === 'HTTP_HANDLER_FAILED' ? 500 : 400,
      payload: { code, token: 'MUST_NOT_ENTER_DIAGNOSTICS', nested: { secret: 'no' } },
    });
    complete(res, code === 'HTTP_HANDLER_FAILED' ? 500 : 400);
  }
  const snapshot = observability.snapshot();
  assert.equal(snapshot.contract, PRODUCTION_DIAGNOSTICS_CONTRACT);
  assert.equal(snapshot.http.completedRequests, 3);
  assert.equal(snapshot.http.activeRequests, 0);
  assert.equal(snapshot.http.recentFailures.length, 2);
  assert.deepEqual(snapshot.http.recentFailures.map(item => item.errorCode), [
    'HTTP_ROUTE_NOT_FOUND',
    'HTTP_HANDLER_FAILED',
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /MUST_NOT_ENTER_DIAGNOSTICS|secret/);
  assert.equal(snapshot.http.statusCounts['4xx'], 2);
  assert.equal(snapshot.http.statusCounts['5xx'], 1);
});

test('connection abort finalizes once as cancelled and does not forge an HTTP status', () => {
  const { logger } = loggerRecords();
  const observability = createProductionObservability({
    logger,
    clock: clock(),
    idFactory: () => 'abort-request',
  });
  const res = new FakeResponse();
  observability.beginHttpRequest({ headers: {} }, res).setRoute('POST /api/chat');
  res.emit('close');
  res.emit('close');
  const snapshot = observability.snapshot();
  assert.equal(snapshot.http.completedRequests, 1);
  assert.equal(snapshot.http.statusCounts.aborted, 1);
  assert.equal(snapshot.http.failureCounts.cancelled, 1);
  assert.equal(snapshot.http.recentFailures[0].statusCode, null);
});

test('invalid client identifiers and error strings cannot enter structured logs', () => {
  const { logger, records } = loggerRecords();
  const observability = createProductionObservability({
    logger,
    clock: clock(),
    idFactory: () => 'safe-request',
  });
  const res = new FakeResponse();
  observability.beginHttpRequest({ headers: { 'x-request-id': 'bad\nlog' } }, res)
    .setRoute('GET /safe');
  observability.observeResponse(res, {
    statusCode: 500,
    payload: { code: 'bad-code\nTOKEN', requestId: '../../bad' },
  });
  complete(res, 500);
  assert.equal(records[0].data.clientRequestId, null);
  assert.equal(records[0].data.operationRequestId, null);
  assert.equal(records[0].data.errorCode, 'HTTP_INTERNAL_ERROR');
});

summary();
