#!/usr/bin/env node

"use strict";

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_PROTOCOL_FUNCTIONS = Object.freeze([
  'validateM1Contract',
  'validateCoreEventStream',
  'classifyTerminal',
  'encodeM1Contract',
  'decodeM1Contract',
  'roundTripM1Contract',
  'isM1ContractEnvelope'
]);

const REQUIRED_BUNDLE_MARKERS = Object.freeze([
  'Generated @c3/protocol M1 runtime is unavailable',
  'm1-wire-v1',
  'core-event-stream-limit',
  'DELIVERY_UNKNOWN',
  'CONVERSATION_BUSY',
  'M1_CONNECTION_REPLACED'
]);

const REQUIRED_CONSUMER_FUNCTIONS = Object.freeze([
  'wsSendChat',
  'wsSendCancel',
  'wsHasActiveM1Turn',
  'wsIsM1WireNegotiated'
]);

function assertRegularFile(filePath, label) {
  let metadata;
  try {
    metadata = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is missing`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`${label} is not a non-empty regular file`);
  }
  return metadata;
}

function validateProtocolRuntime(protocol) {
  if (!protocol || protocol.M1_CONTRACT_VERSION !== 1) {
    throw new Error('Generated M1 protocol version is unavailable or unexpected');
  }
  for (const name of REQUIRED_PROTOCOL_FUNCTIONS) {
    if (typeof protocol[name] !== 'function') {
      throw new Error(`Generated M1 protocol export is missing: ${name}`);
    }
  }
  const progress = {
    contract: 'CoreEvent',
    version: 1,
    requestId: 'postbuild-request',
    conversationId: 'postbuild-conversation',
    turnId: 'postbuild-turn',
    sequence: 1,
    phase: 'progress',
    eventType: 'working',
    payload: {}
  };
  const result = {
    contract: 'ConversationResult',
    version: 1,
    requestId: progress.requestId,
    conversationId: progress.conversationId,
    turnId: progress.turnId,
    status: 'ok',
    response: { content: 'postbuild response' }
  };
  const terminal = {
    contract: 'CoreEvent',
    version: 1,
    requestId: progress.requestId,
    conversationId: progress.conversationId,
    turnId: progress.turnId,
    sequence: 2,
    phase: 'terminal',
    eventType: 'result',
    terminalStatus: 'ok',
    payload: { result }
  };
  const validation = protocol.validateM1Contract(progress, 'CoreEvent');
  if (!validation || validation.valid !== true) {
    throw new Error('Generated M1 protocol rejected the exact postbuild fixture');
  }
  const encoded = protocol.encodeM1Contract(progress);
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('Generated M1 protocol encoder rejected the exact fixture');
  }
  const decoded = protocol.decodeM1Contract(encoded);
  if (!decoded || decoded.requestId !== progress.requestId) {
    throw new Error('Generated M1 protocol decoder changed the exact fixture');
  }
  const roundTripped = protocol.roundTripM1Contract(progress);
  if (!roundTripped || roundTripped.turnId !== progress.turnId) {
    throw new Error('Generated M1 protocol round-trip changed the exact fixture');
  }
  if (protocol.isM1ContractEnvelope(progress) !== true) {
    throw new Error('Generated M1 protocol envelope guard rejected the exact fixture');
  }
  const stream = protocol.validateCoreEventStream([progress, terminal]);
  if (!stream || stream.valid !== true) {
    throw new Error('Generated M1 protocol rejected the exact terminal stream');
  }
  const terminalClassification = protocol.classifyTerminal(result, {
    responseKind: 'conversation'
  });
  if (
    !terminalClassification
    || terminalClassification.valid !== true
    || terminalClassification.status !== 'ok'
    || terminalClassification.renderAssistant !== true
    || terminalClassification.persistAssistant !== true
  ) {
    throw new Error('Generated M1 protocol misclassified the exact terminal result');
  }
}

function validateBundleSource(bundleSource) {
  if (typeof bundleSource !== 'string' || bundleSource.length === 0) {
    throw new Error('Studio production bundle is empty');
  }
  for (const marker of REQUIRED_BUNDLE_MARKERS) {
    if (!bundleSource.includes(marker)) {
      throw new Error(`Studio production bundle is missing M1 marker: ${marker}`);
    }
  }
  if (
    bundleSource.includes('fonts.googleapis.com')
    || bundleSource.includes('fonts.gstatic.com')
  ) {
    throw new Error('Studio production bundle contains forbidden Google Fonts egress');
  }
}

function validateConsumerRuntime(consumer) {
  if (!consumer) throw new Error('Studio M1 consumer is unavailable');
  for (const name of REQUIRED_CONSUMER_FUNCTIONS) {
    if (typeof consumer[name] !== 'function') {
      throw new Error(`Studio M1 consumer export is missing: ${name}`);
    }
  }
}

function probeConsumerRuntime(consumerPath) {
  const probeSource = `
    'use strict';
    const required = ${JSON.stringify(REQUIRED_CONSUMER_FUNCTIONS)};
    const forbidden = name => () => { throw new Error('forbidden top-level effect: ' + name); };
    global.C3Bus = { emit() {} };
    global._sessions = [];
    global.fetch = forbidden('fetch');
    global.setTimeout = forbidden('setTimeout');
    global.WebSocket = class ForbiddenWebSocket {
      constructor() { throw new Error('forbidden top-level effect: WebSocket'); }
    };
    global.setInterval = () => Object.freeze({ unref() {} });
    const consumer = require(process.argv[1]);
    const missing = required.filter(name => typeof consumer[name] !== 'function');
    if (missing.length > 0) throw new Error('missing consumer exports: ' + missing.join(','));
    process.stdout.write(JSON.stringify({ exports: required }));
  `;
  const probe = spawnSync(process.execPath, ['-e', probeSource, consumerPath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10_000
  });
  if (probe.error) {
    throw new Error(`Studio M1 consumer probe failed: ${probe.error.message}`);
  }
  if (probe.status !== 0) {
    const detail = String(probe.stderr || probe.stdout || 'unknown child failure').trim();
    throw new Error(`Studio M1 consumer probe failed: ${detail}`);
  }
  let evidence;
  try {
    evidence = JSON.parse(probe.stdout);
  } catch {
    throw new Error('Studio M1 consumer probe returned malformed evidence');
  }
  if (
    !evidence
    || !Array.isArray(evidence.exports)
    || evidence.exports.join('\n') !== REQUIRED_CONSUMER_FUNCTIONS.join('\n')
  ) {
    throw new Error('Studio M1 consumer probe returned incomplete evidence');
  }
  return evidence;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function verifyM1ConsumerBuild(options = {}) {
  const studioRoot = options.studioRoot || path.resolve(__dirname, '..');
  const protocolPath = path.join(studioRoot, 'extensions', 'c3-protocol', 'lib', 'index.js');
  const consumerPath = path.join(
    studioRoot,
    'extensions',
    'c3-chat-panel',
    'lib',
    'browser',
    'ws-client.js'
  );
  const bundlePath = path.join(
    studioRoot,
    'applications',
    'electron',
    'lib',
    'frontend',
    'bundle.js'
  );
  const protocolMetadata = assertRegularFile(protocolPath, 'generated protocol runtime');
  const consumerMetadata = assertRegularFile(consumerPath, 'authoritative Studio M1 consumer');
  const bundleMetadata = assertRegularFile(bundlePath, 'Studio production bundle');
  const protocol = options.protocol || require(protocolPath);
  validateProtocolRuntime(protocol);
  if (options.consumer) validateConsumerRuntime(options.consumer);
  else probeConsumerRuntime(consumerPath);
  const bundleBytes = fs.readFileSync(bundlePath);
  const bundleSource = bundleBytes.toString('utf8');
  validateBundleSource(bundleSource);
  return Object.freeze({
    bundleBytes: bundleMetadata.size,
    bundleSha256: sha256(bundleBytes),
    consumerBytes: consumerMetadata.size,
    consumerSha256: sha256(fs.readFileSync(consumerPath)),
    protocolBytes: protocolMetadata.size,
    protocolSha256: sha256(fs.readFileSync(protocolPath)),
    protocolVersion: protocol.M1_CONTRACT_VERSION
  });
}

function runCli(options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const evidence = verifyM1ConsumerBuild(options);
    stdout.write(`STUDIO_M1_BUILD_CONSUMER_PASS ${JSON.stringify(evidence)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`STUDIO_M1_BUILD_CONSUMER_FAIL ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  REQUIRED_BUNDLE_MARKERS,
  REQUIRED_CONSUMER_FUNCTIONS,
  REQUIRED_PROTOCOL_FUNCTIONS,
  assertRegularFile,
  probeConsumerRuntime,
  runCli,
  validateBundleSource,
  validateConsumerRuntime,
  validateProtocolRuntime,
  verifyM1ConsumerBuild
};
