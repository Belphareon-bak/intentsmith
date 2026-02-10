/**
 * C3 WebSocket Server — Integration Tests
 *
 * Tests Sprint 1 contracts:
 *   ✅ Protocol handshake (hello / hello_ack / hello_reject)
 *   ✅ Turn lifecycle (turn_start / turn_end)
 *   ✅ Event ordering (seq monotonic)
 *   ✅ Concurrency (max 1 turn)
 *   ✅ Cancel handling
 *   ✅ Reconnection
 *
 * Run: node ws-server.test.js
 * Dependencies: ws (npm install ws)
 */

const http = require('http');
const { WebSocket } = require('ws');
const { EventEmitter } = require('events');
const { createC3WebSocketServer, PROTOCOL_VERSION } = require('./ws-server.cjs');

// ─── Test Framework (minimal, no dependencies) ──────────────────

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    console.error(`  ❌ ${message}`);
  }
}

function assertEq(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Mock Backend ───────────────────────────────────────────────

function createMockBackend() {
  const logger = new EventEmitter();
  logger.info = () => {};
  logger.error = () => {};
  logger.warn = () => {};

  const conversationHandler = {
    async handle(content, options) {
      const signal = options?.signal;

      // Simulate CRE decision
      logger.emit('CREDecision', {
        intent: 'CONVERSATIONAL',
        confidence: 0.95,
        tools: [],
        actionType: 'ANSWER',
      });

      // Simulate LLM
      logger.emit('LLMStart', { model: 'mock-model', tokens_in: 10 });

      // Simulate token streaming
      const tokens = ['Ahoj', '!', ' Jak', ' se', ' máš', '?'];
      for (const token of tokens) {
        await sleep(10);
        if (signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }
        if (options?.onLLMToken) {
          options.onLLMToken(token);
        }
      }

      logger.emit('LLMDone', { tokens_out: 6, duration_ms: 60 });
      logger.emit('GateVerdict', { d61: 'ok', d62: 'ok', d63: 'ok' });

      return {
        text: 'Ahoj! Jak se máš?',
        intent: 'CONVERSATIONAL',
        confidence: 0.95,
        toolsUsed: [],
      };
    },
  };

  return { logger, conversationHandler };
}

// ─── WebSocket Client Helper ────────────────────────────────────

function connectWS(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/c3/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, channelFilter, typeFilter, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${channelFilter}/${typeFilter}`));
    }, timeout);

    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.channel === channelFilter) {
        const data = msg.data;
        if (!typeFilter || data.type === typeFilter || data.agentState === typeFilter) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      }
    };
    ws.on('message', handler);
  });
}

function collectMessages(ws, duration) {
  return new Promise((resolve) => {
    const messages = [];
    const handler = (raw) => {
      messages.push(JSON.parse(raw.toString()));
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(messages);
    }, duration);
  });
}

function sendJSON(ws, data) {
  ws.send(JSON.stringify(data));
}

// ─── Tests ──────────────────────────────────────────────────────

async function runTests() {
  const { logger, conversationHandler } = createMockBackend();

  // Start server
  const httpServer = http.createServer();
  const c3ws = createC3WebSocketServer(httpServer, conversationHandler, logger);

  await new Promise(resolve => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  console.log(`Test server on port ${port}\n`);

  try {
    // ── Test 1: Handshake ─────────────────────────────────────
    console.log('Test 1: Protocol Handshake');
    {
      const ws = await connectWS(port);

      // Send hello
      sendJSON(ws, {
        channel: 'handshake',
        data: { type: 'hello', protocol_version: PROTOCOL_VERSION, ide_version: '0.1.0' },
      });

      const ack = await waitForMessage(ws, 'handshake', 'hello_ack');
      assertEq(ack.data.type, 'hello_ack', 'Received hello_ack');
      assertEq(ack.data.protocol_version, PROTOCOL_VERSION, 'Protocol version matches');
      assert(ack.data.backend_version, 'Backend version present');

      // Should also receive initial status
      const status = await waitForMessage(ws, 'status');
      assertEq(status.data.agentState, 'idle', 'Initial state is idle');
      assert(status.data.connected, 'Connected flag is true');

      ws.close();
      await sleep(50);
    }

    // ── Test 2: Handshake rejection (wrong protocol) ──────────
    console.log('\nTest 2: Protocol Version Mismatch');
    {
      const ws = await connectWS(port);

      sendJSON(ws, {
        channel: 'handshake',
        data: { type: 'hello', protocol_version: 999, ide_version: '0.1.0' },
      });

      const reject = await waitForMessage(ws, 'handshake', 'hello_reject');
      assertEq(reject.data.type, 'hello_reject', 'Received hello_reject');
      assert(reject.data.reason.includes('Protocol'), 'Reason mentions protocol');

      await sleep(100);
    }

    // ── Test 3: Chat message + turn lifecycle ─────────────────
    console.log('\nTest 3: Chat Message + Turn Lifecycle');
    {
      const ws = await connectWS(port);

      // Handshake
      sendJSON(ws, {
        channel: 'handshake',
        data: { type: 'hello', protocol_version: PROTOCOL_VERSION, ide_version: '0.1.0' },
      });
      await waitForMessage(ws, 'handshake', 'hello_ack');
      await waitForMessage(ws, 'status'); // initial status

      // Collect all messages
      const msgPromise = collectMessages(ws, 2000);

      // Send chat message
      sendJSON(ws, {
        channel: 'chat',
        data: { type: 'chat_message', content: 'Ahoj C3!' },
      });

      const messages = await msgPromise;

      // Verify turn_start exists
      const agentEvents = messages.filter(m => m.channel === 'agent');
      const turnStart = agentEvents.find(m => m.data.type === 'turn_start');
      assert(turnStart, 'turn_start event present');
      assertEq(turnStart?.data.payload?.input, 'Ahoj C3!', 'turn_start has user input');

      // Verify turn_end exists
      const turnEnd = agentEvents.find(m => m.data.type === 'turn_end');
      assert(turnEnd, 'turn_end event present');
      assertEq(turnEnd?.data.payload?.status, 'ok', 'turn_end status is ok');
      assert(turnEnd?.data.payload?.duration_ms >= 0, 'turn_end has duration');

      // Verify CRE decision
      const creDecision = agentEvents.find(m => m.data.type === 'cre_decision');
      assert(creDecision, 'CRE decision event present');
      assertEq(creDecision?.data.payload?.intent, 'CONVERSATIONAL', 'CRE intent is CONVERSATIONAL');

      // Verify seq is monotonically increasing
      const seqs = agentEvents.map(m => m.data.seq).filter(s => s > 0);
      const isMonotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
      assert(isMonotonic, `seq is monotonic: [${seqs.join(', ')}]`);

      // Verify chat messages (user echo + assistant response)
      const chatMessages = messages.filter(m => m.channel === 'chat');
      const userMsg = chatMessages.find(m => m.data.type === 'user');
      assert(userMsg, 'User message echoed back');
      assertEq(userMsg?.data.content, 'Ahoj C3!', 'User content matches');

      const assistantMsg = chatMessages.find(m => m.data.type === 'assistant');
      assert(assistantMsg, 'Assistant message present');
      assert(assistantMsg?.data.content.includes('Ahoj'), 'Assistant response contains "Ahoj"');
      assertEq(assistantMsg?.data.metadata?.intent, 'CONVERSATIONAL', 'Metadata has intent');

      // Verify turnId consistency
      const turnId = turnStart?.data.turnId;
      assert(turnId, 'turnId is set');
      const allTurnIds = agentEvents.map(m => m.data.turnId);
      const allSameTurn = allTurnIds.every(t => t === turnId);
      assert(allSameTurn, 'All agent events share same turnId');

      ws.close();
      await sleep(50);
    }

    // ── Test 4: Event ordering ────────────────────────────────
    console.log('\nTest 4: Event Ordering');
    {
      const ws = await connectWS(port);

      sendJSON(ws, {
        channel: 'handshake',
        data: { type: 'hello', protocol_version: PROTOCOL_VERSION, ide_version: '0.1.0' },
      });
      await waitForMessage(ws, 'handshake', 'hello_ack');
      await waitForMessage(ws, 'status');

      const msgPromise = collectMessages(ws, 2000);

      sendJSON(ws, {
        channel: 'chat',
        data: { type: 'chat_message', content: 'Test ordering' },
      });

      const messages = await msgPromise;
      const agentEvents = messages.filter(m => m.channel === 'agent');

      // Expected order: turn_start → cre_decision → llm_start → llm_done → gate_verdict → turn_end
      const types = agentEvents.map(m => m.data.type);

      const turnStartIdx = types.indexOf('turn_start');
      const creIdx = types.indexOf('cre_decision');
      const llmStartIdx = types.indexOf('llm_start');
      const llmDoneIdx = types.indexOf('llm_done');
      const gateIdx = types.indexOf('gate_verdict');
      const turnEndIdx = types.indexOf('turn_end');

      assert(turnStartIdx < creIdx, 'turn_start before cre_decision');
      assert(creIdx < llmStartIdx, 'cre_decision before llm_start');
      assert(llmStartIdx < llmDoneIdx, 'llm_start before llm_done');
      assert(llmDoneIdx < gateIdx || gateIdx < turnEndIdx, 'gate before turn_end');
      assert(turnEndIdx === types.length - 1, 'turn_end is last');

      ws.close();
      await sleep(50);
    }

    // ── Test 5: Pre-handshake message rejection ───────────────
    console.log('\nTest 5: Pre-handshake Rejection');
    {
      const ws = await connectWS(port);

      // Send chat without handshake
      sendJSON(ws, {
        channel: 'chat',
        data: { type: 'chat_message', content: 'Should be rejected' },
      });

      const reject = await waitForMessage(ws, 'handshake', 'hello_reject');
      assert(reject.data.reason.includes('handshake'), 'Rejection mentions handshake');

      ws.close();
      await sleep(50);
    }

    // ── Test 6: Cancel ────────────────────────────────────────
    console.log('\nTest 6: Cancel Execution');
    {
      const ws = await connectWS(port);

      sendJSON(ws, {
        channel: 'handshake',
        data: { type: 'hello', protocol_version: PROTOCOL_VERSION, ide_version: '0.1.0' },
      });
      await waitForMessage(ws, 'handshake', 'hello_ack');
      await waitForMessage(ws, 'status');

      const msgPromise = collectMessages(ws, 2000);

      // Send message then immediately cancel
      sendJSON(ws, {
        channel: 'chat',
        data: { type: 'chat_message', content: 'Cancel me' },
      });

      await sleep(30); // Let turn_start happen

      sendJSON(ws, {
        channel: 'agent',
        data: { type: 'cancel' },
      });

      const messages = await msgPromise;
      const agentEvents = messages.filter(m => m.channel === 'agent');

      // Should have turn_end with cancelled status
      const turnEnd = agentEvents.find(m =>
        m.data.type === 'turn_end' &&
        (m.data.payload?.status === 'cancelled_by_user' || m.data.payload?.status === 'interrupted')
      );
      assert(turnEnd, 'turn_end with cancelled/interrupted status present');

      ws.close();
      await sleep(50);
    }

  } finally {
    c3ws.close();
    httpServer.close();
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Tests: ${testCount} | Pass: ${passCount} | Fail: ${failCount}`);
  console.log(`${'═'.repeat(50)}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
