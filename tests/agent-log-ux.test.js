// Agent Log UX — E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests: formatAgentEvent (_raw), groupByTurn, pairEvents, render integration
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ASYNC_TEST_TIMEOUT_MS = 10_000;

// CJS modules from IDE extension
const { formatAgentEvent } = require(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/agent-client.js'
);
const { groupByTurn, pairEvents, render } = require(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/agent-log-renderer.js'
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mkEvent(type, turnId, payload = {}, ts) {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2, 6),
    seq: 0,
    turnId,
    type,
    timestamp: ts || new Date().toISOString(),
    payload,
  };
}

function mkTurnStart(turnId, input, ts) {
  return mkEvent('turn_start', turnId, { input, turnNumber: 1 }, ts);
}

function mkTurnEnd(turnId, status, durationMs, ts) {
  return mkEvent('turn_end', turnId, { status, durationMs }, ts);
}

function mkToolCall(turnId, tool, args, ts) {
  return mkEvent('tool_call', turnId, { tool, args }, ts);
}

function mkToolResult(turnId, tool, result, durationMs, ts) {
  return mkEvent('tool_result', turnId, { tool, result, durationMs, success: true }, ts);
}

function mkLLMStart(turnId, model, ts) {
  return mkEvent('llm_start', turnId, { model, tokensIn: 100 }, ts);
}

function mkLLMDone(turnId, tokensOut, durationMs, ts) {
  return mkEvent('llm_done', turnId, { tokensOut, durationMs }, ts);
}

function mkSystemStep(turnId, step, detail, ts) {
  return mkEvent('system_step', turnId, { step, detail }, ts);
}

function mkCREDecision(turnId, intent, confidence, ts) {
  return mkEvent('cre_decision', turnId, { intent, confidence, actionType: 'ANSWER' }, ts);
}

function mkGateVerdict(turnId, ok, dimension, ts) {
  return mkEvent('gate_verdict', turnId, { ok, dimension, score: 0.9 }, ts);
}

function mkError(turnId, message, ts) {
  return mkEvent('error', turnId, { message, code: 'TEST' }, ts);
}

// Format raw events into log entries (as agent-client does)
function fmtAll(events) {
  return events.map(e => formatAgentEvent(e)).filter(Boolean);
}

// Minimal mock h() for render testing
function mockH(tag, props, ...children) {
  return { tag, props, children: children.flat().filter(Boolean) };
}
const mockC = { mono: 'mono', tx1: '#fff', tx2: '#ccc', tx3: '#999', tx4: '#666',
  bg1: '#111', bg2: '#222', bg3: '#333', border: '#444', accent: '#0f0',
  cyan: '#0ff', purple: '#f0f', amber: '#fa0', accentText: '#0f0',
  blue: '#00f', red: '#f00', font: 'sans' };
const mockTC = { cre: '#0ff', llm: '#f0f', tool: '#fa0', gate: '#0f0', sys: '#999' };
const mockFs = (n) => n;


// ═══════════════════════════════════════════════════════════════════════════════

suite('formatAgentEvent — _raw field');

test('turn_start produces _raw with eventType and input', () => {
  const entry = formatAgentEvent(mkTurnStart('t-001', 'Ahoj'));
  assert(entry !== null, 'should not be null');
  assert(entry._raw, '_raw must exist');
  assertEqual(entry._raw.eventType, 'turn_start');
  assertEqual(entry._raw.input, 'Ahoj');
  assert(entry._raw.timestamp, 'timestamp must exist');
  assertEqual(entry.turnId, 't-001');
});

test('tool_call produces _raw with tool and args', () => {
  const entry = formatAgentEvent(mkToolCall('t-001', 'web_search', { query: 'test' }));
  assertEqual(entry._raw.eventType, 'tool_call');
  assertEqual(entry._raw.tool, 'web_search');
  assert(entry._raw.args, 'args must exist');
});

test('tool_result produces _raw with tool, result, durationMs', () => {
  const entry = formatAgentEvent(mkToolResult('t-001', 'web_search', '5 results', 234));
  assertEqual(entry._raw.eventType, 'tool_result');
  assertEqual(entry._raw.tool, 'web_search');
  assertEqual(entry._raw.durationMs, 234);
  assertEqual(entry._raw.result, '5 results');
  assert(entry._raw.success === true, 'success should be true');
});

test('llm_start produces _raw with model', () => {
  const entry = formatAgentEvent(mkLLMStart('t-001', 'qwen3.5:27b'));
  assertEqual(entry._raw.eventType, 'llm_start');
  assertEqual(entry._raw.model, 'qwen3.5:27b');
  assertEqual(entry._raw.tokensIn, 100);
});

test('llm_done produces _raw with tokensOut and durationMs', () => {
  const entry = formatAgentEvent(mkLLMDone('t-001', 256, 4200));
  assertEqual(entry._raw.eventType, 'llm_done');
  assertEqual(entry._raw.tokensOut, 256);
  assertEqual(entry._raw.durationMs, 4200);
});

test('system_step produces _raw with step and detail', () => {
  const entry = formatAgentEvent(mkSystemStep('t-001', 'handler_selected', 'conversation'));
  assertEqual(entry._raw.eventType, 'system_step');
  assertEqual(entry._raw.step, 'handler_selected');
  assertEqual(entry._raw.detail, 'conversation');
  assertEqual(entry.type, 'SYS');
  assertEqual(entry.cls, 'sys');
  assert(entry.text.includes('Režim') || entry.text.includes('handler_selected'), 'text should contain step label or step name');
});

test('gate_verdict produces _raw with intent and confidence', () => {
  const entry = formatAgentEvent(mkGateVerdict('t-001', true, 'D6.1'));
  assertEqual(entry._raw.eventType, 'gate_verdict');
  assertEqual(entry.type, 'GATE');
});

test('error produces _raw with status', () => {
  const entry = formatAgentEvent(mkError('t-001', 'Something failed'));
  assertEqual(entry._raw.eventType, 'error');
  assertEqual(entry.type, 'ERROR');
  assert(entry.text.includes('Something failed'), 'text should contain error message');
});

test('llm_token is skipped (returns null)', () => {
  const entry = formatAgentEvent(mkEvent('llm_token', 't-001', { token: 'a' }));
  assert(entry === null, 'llm_token should return null');
});

test('callId field exists in _raw (null by default)', () => {
  const entry = formatAgentEvent(mkToolCall('t-001', 'shell', {}));
  assert(entry._raw.callId === null, 'callId should be null by default');
});

test('callId from payload is preserved', () => {
  const entry = formatAgentEvent(mkEvent('tool_call', 't-001', { tool: 'shell', callId: 'c-42' }));
  assertEqual(entry._raw.callId, 'c-42');
});

test('turn_end with durationMs is preserved in _raw', () => {
  const entry = formatAgentEvent(mkTurnEnd('t-001', 'ok', 9800));
  assertEqual(entry._raw.eventType, 'turn_end');
  assertEqual(entry._raw.status, 'ok');
  assertEqual(entry._raw.durationMs, 9800);
});

// ═══════════════════════════════════════════════════════════════════════════════

suite('groupByTurn — turn grouping');

test('single complete turn groups correctly', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Ahoj'),
    mkSystemStep('t-001', 'handler_selected', 'conversation'),
    mkCREDecision('t-001', 'CONVERSATIONAL', 0.95),
    mkLLMStart('t-001', 'qwen3.5:27b'),
    mkLLMDone('t-001', 256, 4200),
    mkTurnEnd('t-001', 'ok', 5000),
  ]);

  const groups = groupByTurn(log);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].type, 'turn');
  assertEqual(groups[0].turnId, 't-001');
  assertEqual(groups[0].turnNum, 1);
  assertEqual(groups[0].status, 'ok');
  assertEqual(groups[0].events.length, 6);
});

test('two turns produce two groups', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'First'),
    mkTurnEnd('t-001', 'ok', 1000),
    mkTurnStart('t-002', 'Second'),
    mkTurnEnd('t-002', 'ok', 2000),
  ]);

  const groups = groupByTurn(log);
  assertEqual(groups.length, 2);
  assertEqual(groups[0].turnNum, 1);
  assertEqual(groups[1].turnNum, 2);
  assertEqual(groups[0].turnId, 't-001');
  assertEqual(groups[1].turnId, 't-002');
});

test('system entry without turnId breaks grouping', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'First'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);
  // Add a system event without turnId
  log.push({ time: '12:00', text: 'Projekt otevřen: klicenka', turnId: null, _raw: {} });
  const log2 = fmtAll([
    mkTurnStart('t-002', 'Second'),
    mkTurnEnd('t-002', 'ok', 2000),
  ]);
  log.push(...log2);

  const groups = groupByTurn(log);
  assertEqual(groups.length, 3);
  assertEqual(groups[0].type, 'turn');
  assertEqual(groups[1].type, 'system');
  assertEqual(groups[1].event.text, 'Projekt otevřen: klicenka');
  assertEqual(groups[2].type, 'turn');
});

test('incomplete turn (no turn_end) gets status=incomplete', () => {
  const t1 = '2026-02-26T10:00:00.000Z';
  const t2 = '2026-02-26T10:00:03.000Z';
  const log = fmtAll([
    mkTurnStart('t-001', 'Running...', t1),
    mkLLMStart('t-001', 'qwen3.5:27b', t2),
    // no turn_end!
  ]);

  const groups = groupByTurn(log);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].status, 'incomplete');
  // Duration estimated from last - first
  assertEqual(groups[0].durationMs, 3000);
});

test('cancelled turn gets correct status', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Cancel me'),
    mkTurnEnd('t-001', 'cancelled_by_user', 500),
  ]);

  const groups = groupByTurn(log);
  assertEqual(groups[0].status, 'cancelled_by_user');
});

test('error turn gets correct status', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Will fail'),
    mkTurnEnd('t-001', 'error', 100),
  ]);

  const groups = groupByTurn(log);
  assertEqual(groups[0].status, 'error');
});

test('turn input extracted from turn_start _raw', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Jaká je úroková sazba?'),
    mkTurnEnd('t-001', 'ok', 5000),
  ]);

  const groups = groupByTurn(log);
  assertEqual(groups[0].input, 'Jaká je úroková sazba?');
});

test('empty log returns empty groups', () => {
  const groups = groupByTurn([]);
  assertEqual(groups.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════

suite('pairEvents — tool + LLM pairing');

test('tool_call + tool_result pair into single step', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'web_search', { query: 'test' }),
    mkToolResult('t-001', 'web_search', '5 results', 234),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 1);
  assertEqual(steps[0].type, 'tool');
  assert(steps[0].call, 'must have call');
  assert(steps[0].result, 'must have result');
  assertEqual(steps[0].call._raw.tool, 'web_search');
  assertEqual(steps[0].result._raw.durationMs, 234);
});

test('tool_call without result shows as unpaired', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'shell', { command: 'npm test' }),
    // no tool_result
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 1);
  assertEqual(steps[0].type, 'tool');
  assert(steps[0].call, 'must have call');
  assert(steps[0].result === null, 'result should be null');
});

test('llm_start + llm_done pair into single step', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkLLMStart('t-001', 'qwen3.5:27b'),
    mkLLMDone('t-001', 256, 4200),
    mkTurnEnd('t-001', 'ok', 5000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 1);
  assertEqual(steps[0].type, 'llm');
  assert(steps[0].start, 'must have start');
  assert(steps[0].done, 'must have done');
  assertEqual(steps[0].start._raw.model, 'qwen3.5:27b');
  assertEqual(steps[0].done._raw.tokensOut, 256);
  assertEqual(steps[0].done._raw.durationMs, 4200);
});

test('llm_start without llm_done shows as unpaired', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkLLMStart('t-001', 'qwen3.5:27b'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 1);
  assertEqual(steps[0].type, 'llm');
  assert(steps[0].done === null, 'done should be null');
});

test('system_step appears as standalone event step', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkSystemStep('t-001', 'cre_decided', 'ANSWER / CONVERSATIONAL'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 1);
  assertEqual(steps[0].type, 'event');
  assertEqual(steps[0].event.cls, 'sys');
});

test('gate_verdict appears as standalone event step', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkGateVerdict('t-001', true, 'D6.1'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 1);
  assertEqual(steps[0].type, 'event');
  assertEqual(steps[0].event.cls, 'gate');
});

test('turn_start and turn_end are skipped (not in steps)', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 0);
});

test('full realistic turn: multiple tools + LLM + system steps', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'Jaká je úroková sazba?'),
    mkSystemStep('t-001', 'handler_selected', 'conversation'),
    mkCREDecision('t-001', 'SEARCH', 0.92),
    mkSystemStep('t-001', 'cre_decided', 'TOOL_CALL / SEARCH'),
    mkToolCall('t-001', 'web_search', { query: 'úroková sazba 2026' }),
    mkToolResult('t-001', 'web_search', '5 results', 234),
    mkSystemStep('t-001', 'prompt_built', '1240 chars, system: 380'),
    mkLLMStart('t-001', 'qwen3.5:27b'),
    mkLLMDone('t-001', 256, 4200),
    mkGateVerdict('t-001', true, null),
    mkSystemStep('t-001', 'quality_d6', '\u2705'),
    mkTurnEnd('t-001', 'ok', 9800),
  ]);

  const steps = pairEvents(events);
  // Expected: handler_selected(sys) + cre_decision(event) + cre_decided(sys) +
  //           web_search(tool paired) + prompt_built(sys) + LLM(llm paired) +
  //           gate_verdict(event) + quality_d6(sys) = 8 steps
  assertEqual(steps.length, 8);

  assertEqual(steps[0].type, 'event'); // handler_selected
  assertEqual(steps[0].event.cls, 'sys');
  assertEqual(steps[1].type, 'event'); // cre_decision
  assertEqual(steps[1].event.cls, 'cre');
  assertEqual(steps[2].type, 'event'); // cre_decided
  assertEqual(steps[2].event.cls, 'sys');
  assertEqual(steps[3].type, 'tool');  // web_search paired
  assert(steps[3].result !== null, 'tool result should be paired');
  assertEqual(steps[4].type, 'event'); // prompt_built
  assertEqual(steps[5].type, 'llm');   // LLM paired
  assert(steps[5].done !== null, 'llm done should be paired');
  assertEqual(steps[6].type, 'event'); // gate_verdict
  assertEqual(steps[7].type, 'event'); // quality_d6
});

test('two consecutive tool calls pair correctly', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'web_search', {}),
    mkToolResult('t-001', 'web_search', 'ok', 100),
    mkToolCall('t-001', 'shell', { command: 'ls' }),
    mkToolResult('t-001', 'shell', 'done', 200),
    mkTurnEnd('t-001', 'ok', 500),
  ]);

  const steps = pairEvents(events);
  assertEqual(steps.length, 2);
  assertEqual(steps[0].type, 'tool');
  assertEqual(steps[0].call._raw.tool, 'web_search');
  assertEqual(steps[0].result._raw.tool, 'web_search');
  assertEqual(steps[1].type, 'tool');
  assertEqual(steps[1].call._raw.tool, 'shell');
  assertEqual(steps[1].result._raw.tool, 'shell');
});

test('tool_result beyond lookahead window (>5) is not paired', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'slow_tool', {}),
    // 6 intervening events (beyond lookahead of 5)
    mkSystemStep('t-001', 'a', '1'),
    mkSystemStep('t-001', 'b', '2'),
    mkSystemStep('t-001', 'c', '3'),
    mkSystemStep('t-001', 'd', '4'),
    mkSystemStep('t-001', 'e', '5'),
    mkSystemStep('t-001', 'f', '6'),
    mkToolResult('t-001', 'slow_tool', 'late', 5000),
    mkTurnEnd('t-001', 'ok', 6000),
  ]);

  const steps = pairEvents(events);
  // tool_call should NOT be paired (result too far away)
  const toolStep = steps.find(s => s.type === 'tool');
  assert(toolStep, 'should have tool step');
  assert(toolStep.result === null, 'result should be null (beyond lookahead)');
  // The tool_result should appear as standalone
  const standaloneResult = steps.find(s =>
    s.type === 'event' && s.event._raw && s.event._raw.eventType === 'tool_result'
  );
  assert(standaloneResult, 'orphaned tool_result should be standalone event');
});

// ═══════════════════════════════════════════════════════════════════════════════

suite('render — integration');

test('empty log renders placeholder', () => {
  const result = render(mockH, { log: [] }, mockC, mockTC, mockFs, {}, () => {});
  assert(result, 'should return something');
  assertEqual(result.tag, 'div');
  assert(result.children.some(c => typeof c === 'string' && c.includes('dn')),
    'should contain "Žádné události" text');
});

test('single complete turn renders collapsible group', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Test input'),
    mkSystemStep('t-001', 'handler_selected', 'conversation'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const result = render(mockH, { log }, mockC, mockTC, mockFs, {}, () => {});
  assertEqual(result.tag, 'div');
  // Should have 1 child (the turn group)
  assertEqual(result.children.length, 1);
  const turnGroup = result.children[0];
  assertEqual(turnGroup.tag, 'div');
  // Expanded: should have header + body
  assertEqual(turnGroup.children.length, 2);
});

test('collapsed turn renders only header (no body)', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Test'),
    mkSystemStep('t-001', 'x', 'y'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  const collapsed = { 't-001': true };
  const result = render(mockH, { log }, mockC, mockTC, mockFs, collapsed, () => {});
  const turnGroup = result.children[0];
  // Collapsed: only header, no body
  assertEqual(turnGroup.children.length, 1);
});

test('last incomplete turn is auto-expanded even if collapsed flag set', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Running...'),
    mkLLMStart('t-001', 'model'),
    // no turn_end → incomplete
  ]);

  const collapsed = { 't-001': true };
  const result = render(mockH, { log }, mockC, mockTC, mockFs, collapsed, () => {});
  const turnGroup = result.children[0];
  // Should be expanded despite collapsed flag (last + incomplete)
  assertEqual(turnGroup.children.length, 2);
});

test('toggle callback is called with turnId', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'Click me'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);

  let toggledTurnId = null;
  const result = render(mockH, { log }, mockC, mockTC, mockFs, {}, (tid) => {
    toggledTurnId = tid;
  });

  // Find the header div and simulate click
  const turnGroup = result.children[0];
  const header = turnGroup.children[0];
  assert(header.props.onClick, 'header should have onClick');
  header.props.onClick();
  assertEqual(toggledTurnId, 't-001');
});

test('system entry renders between turns', () => {
  const log = fmtAll([
    mkTurnStart('t-001', 'First'),
    mkTurnEnd('t-001', 'ok', 1000),
  ]);
  log.push({ time: '12:00', text: 'System message', turnId: null, _raw: {} });
  const log2 = fmtAll([
    mkTurnStart('t-002', 'Second'),
    mkTurnEnd('t-002', 'ok', 2000),
  ]);
  log.push(...log2);

  const result = render(mockH, { log }, mockC, mockTC, mockFs, {}, () => {});
  assertEqual(result.children.length, 3);
  // Middle child should be the system entry
  const sysEntry = result.children[1];
  assert(sysEntry.props.style.fontStyle === 'italic', 'system entry should be italic');
});

// ═══════════════════════════════════════════════════════════════════════════════

suite('Edge cases');

test('200+ events in single turn — no error', () => {
  const events = [mkTurnStart('t-001', 'Stress test')];
  for (let i = 0; i < 100; i++) {
    events.push(mkToolCall('t-001', 'tool_' + i, {}));
    events.push(mkToolResult('t-001', 'tool_' + i, 'ok', 10));
  }
  events.push(mkTurnEnd('t-001', 'ok', 10000));

  const log = fmtAll(events);
  const groups = groupByTurn(log);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].events.length, 202); // 1 start + 200 tool + 1 end

  const steps = pairEvents(groups[0].events);
  assertEqual(steps.length, 100); // 100 paired tool steps
  for (const s of steps) {
    assertEqual(s.type, 'tool');
    assert(s.result !== null, 'all tools should be paired within lookahead');
  }
});

test('multiple system_step events interleaved with tools', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkSystemStep('t-001', 'handler_selected', 'conversation'),
    mkSystemStep('t-001', 'cre_decided', 'TOOL_CALL / SEARCH'),
    mkToolCall('t-001', 'web_search', {}),
    mkSystemStep('t-001', 'prompt_built', '500 chars'),
    mkToolResult('t-001', 'web_search', 'ok', 100),
    mkLLMStart('t-001', 'model'),
    mkLLMDone('t-001', 128, 2000),
    mkSystemStep('t-001', 'quality_d6', '\u2705'),
    mkTurnEnd('t-001', 'ok', 3000),
  ]);

  const steps = pairEvents(events);
  // handler_selected, cre_decided, web_search(paired), prompt_built, LLM(paired), quality_d6
  assertEqual(steps.length, 6);
  assertEqual(steps[0].type, 'event');
  assertEqual(steps[1].type, 'event');
  assertEqual(steps[2].type, 'tool');
  assert(steps[2].result !== null, 'tool paired despite sys step in between');
  assertEqual(steps[3].type, 'event');
  assertEqual(steps[4].type, 'llm');
  assertEqual(steps[5].type, 'event');
});

test('tool pairing with sys step between call and result (within lookahead)', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'shell', { command: 'npm test' }),
    mkSystemStep('t-001', 'prompt_built', '100 chars'),
    mkSystemStep('t-001', 'waiting', 'for result'),
    mkToolResult('t-001', 'shell', 'exit 0', 1500),
    mkTurnEnd('t-001', 'ok', 2000),
  ]);

  const steps = pairEvents(events);
  // tool (paired), sys, sys
  // Actually: tool_call pairs with tool_result (j=3, within 5),
  // the 2 sys steps in between are standalone events
  assertEqual(steps.length, 3);
  assertEqual(steps[0].type, 'tool');
  assert(steps[0].result !== null, 'tool should be paired (result at j=3)');
  assertEqual(steps[1].type, 'event'); // sys
  assertEqual(steps[2].type, 'event'); // sys
});

test('different tool names are not incorrectly paired', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'tool_A', {}),
    mkToolResult('t-001', 'tool_B', 'wrong', 100), // different name!
    mkToolResult('t-001', 'tool_A', 'correct', 200),
    mkTurnEnd('t-001', 'ok', 500),
  ]);

  const steps = pairEvents(events);
  // tool_A call should pair with tool_A result (skip tool_B result)
  const toolStep = steps.find(s => s.type === 'tool');
  assert(toolStep, 'should have tool step');
  assertEqual(toolStep.call._raw.tool, 'tool_A');
  assert(toolStep.result !== null, 'should be paired');
  assertEqual(toolStep.result._raw.tool, 'tool_A');
});

test('pairEvents resets _paired markers on each call (idempotent)', () => {
  const events = fmtAll([
    mkTurnStart('t-001', 'x'),
    mkToolCall('t-001', 'shell', {}),
    mkToolResult('t-001', 'shell', 'ok', 50),
    mkTurnEnd('t-001', 'ok', 100),
  ]);

  // Call twice — second call should produce same result
  const steps1 = pairEvents(events);
  const steps2 = pairEvents(events);
  assertEqual(steps1.length, steps2.length);
  assertEqual(steps1[0].type, steps2[0].type);
});

// ═══════════════════════════════════════════════════════════════════════════════

suite('BE instrumentation — onSystemStep hook');

// We can't test session-adapter directly (ESM + dependencies),
// but we can test the protocol constant exists
await testAsync('SYSTEM_STEP constant exists in protocol', async () => {
  const { AgentEventType } = await import('../src/ws-bridge/protocol.js');
  assertEqual(AgentEventType.SYSTEM_STEP, 'system_step');
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('buildAgentEvent creates valid event with system_step type', async () => {
  const { buildAgentEvent } = await import('../src/ws-bridge/protocol.js');
  const evt = buildAgentEvent(1, 'system_step', 't-001', { step: 'test', detail: 'ok' });
  assertEqual(evt.type, 'system_step');
  assertEqual(evt.turnId, 't-001');
  assertEqual(evt.payload.step, 'test');
  assertEqual(evt.payload.detail, 'ok');
  assert(evt.id.startsWith('evt-'), 'id should start with evt-');
  assert(evt.timestamp, 'timestamp must exist');
}, ASYNC_TEST_TIMEOUT_MS);

// ═══════════════════════════════════════════════════════════════════════════════

suite('Full pipeline — event → format → group → pair → render');

test('realistic 2-turn conversation renders correctly', () => {
  const rawEvents = [
    mkTurnStart('t-001', 'Jaká je úroková sazba?'),
    mkSystemStep('t-001', 'handler_selected', 'conversation'),
    mkCREDecision('t-001', 'SEARCH', 0.92),
    mkSystemStep('t-001', 'cre_decided', 'TOOL_CALL / SEARCH'),
    mkToolCall('t-001', 'web_search', { query: 'úroková sazba' }),
    mkToolResult('t-001', 'web_search', '5 results', 234),
    mkSystemStep('t-001', 'prompt_built', '1240 chars, system: 380'),
    mkLLMStart('t-001', 'qwen3.5:27b'),
    mkLLMDone('t-001', 256, 4200),
    mkGateVerdict('t-001', true, null),
    mkSystemStep('t-001', 'quality_d6', '\u2705'),
    mkTurnEnd('t-001', 'ok', 9800),
    // Turn 2
    mkTurnStart('t-002', 'Navrhni spec'),
    mkSystemStep('t-002', 'handler_selected', 'conversation'),
    mkCREDecision('t-002', 'DESIGN', 0.88),
    mkLLMStart('t-002', 'qwen3.5:27b'),
    mkLLMDone('t-002', 512, 8000),
    mkTurnEnd('t-002', 'ok', 12100),
  ];

  // Step 1: Format
  const log = fmtAll(rawEvents);
  assertEqual(log.length, 18); // 18 events (llm_token skipped, all others pass)

  // Step 2: Group
  const groups = groupByTurn(log);
  assertEqual(groups.length, 2);
  assertEqual(groups[0].turnId, 't-001');
  assertEqual(groups[0].input, 'Jaká je úroková sazba?');
  assertEqual(groups[0].status, 'ok');
  assertEqual(groups[0].durationMs, 9800);
  assertEqual(groups[1].turnId, 't-002');
  assertEqual(groups[1].input, 'Navrhni spec');
  assertEqual(groups[1].durationMs, 12100);

  // Step 3: Pair (turn 1)
  const steps1 = pairEvents(groups[0].events);
  assertEqual(steps1.length, 8);
  // handler_selected, CRE, cre_decided, web_search, prompt_built, LLM, gate, quality_d6

  // Step 4: Pair (turn 2)
  const steps2 = pairEvents(groups[1].events);
  assertEqual(steps2.length, 3);
  // handler_selected, CRE, LLM

  // Step 5: Render
  const toggles = {};
  let lastToggled = null;
  const tree = render(mockH, { log }, mockC, mockTC, mockFs, toggles, (tid) => {
    lastToggled = tid;
  });

  assertEqual(tree.tag, 'div');
  assertEqual(tree.children.length, 2); // 2 turn groups

  // Both expanded by default
  assertEqual(tree.children[0].children.length, 2); // header + body
  assertEqual(tree.children[1].children.length, 2);

  // Toggle turn 1 → collapsed
  tree.children[0].children[0].props.onClick();
  assertEqual(lastToggled, 't-001');
});

// ═══════════════════════════════════════════════════════════════════════════════

const results = summary();
if (results.failed > 0) process.exit(1);
