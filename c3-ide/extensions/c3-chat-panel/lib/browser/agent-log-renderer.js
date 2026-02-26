// C3 Studio — Agent Log Renderer
// ══════════════════════════════════════════════════════════════════════════════
//
// Extracted rendering module for agent log panel.
// Groups events by turn, pairs tool_call/result and llm_start/done,
// renders collapsible turn groups with structured step display.
//
// Depends on: React (h), C (colors), TC (type colors), _fs (font scaling)
// Consumed by: chat-panel-module.js → _agentLogContent()
//
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

/* ─── Step icons by event class ───────────────────────────────────────── */

var _stepIcons = {
  tool: '\uD83D\uDD27',  // wrench
  llm:  '\u23F3',         // hourglass
  cre:  '\uD83E\uDDE0',  // brain
  gate: '\uD83D\uDEA6',  // traffic light
  sys:  '\u2699\uFE0F',  // gear
  error:'\u26A0\uFE0F',  // warning
  info: '\u2139\uFE0F',  // info
  edit: '\u270F\uFE0F'   // pencil
};

/* ─── Duration formatter ──────────────────────────────────────────────── */

function _fmtDur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function _trunc(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len - 1) + '\u2026';
}

/* ─── groupByTurn ─────────────────────────────────────────────────────── */

function groupByTurn(log) {
  var groups = [];
  var currentTurn = null;
  var turnNum = 0;

  for (var i = 0; i < log.length; i++) {
    var e = log[i];
    if (e.turnId) {
      if (!currentTurn || currentTurn.turnId !== e.turnId) {
        turnNum++;
        currentTurn = {
          type: 'turn',
          turnId: e.turnId,
          turnNum: turnNum,
          events: [],
          input: '',
          durationMs: 0,
          status: 'pending',
        };
        groups.push(currentTurn);
      }
      currentTurn.events.push(e);

      // Extract metadata from _raw
      if (e._raw) {
        if (e._raw.eventType === 'turn_start') {
          currentTurn.input = e._raw.input || e.text || '';
        }
        if (e._raw.eventType === 'turn_end') {
          currentTurn.durationMs = e._raw.durationMs;
          currentTurn.status = e._raw.status || 'ok';
        }
      }
    } else {
      // System entry — always breaks turn grouping
      currentTurn = null;
      groups.push({ type: 'system', event: e });
    }
  }

  // Handle incomplete turns (missing turn_end)
  for (var j = 0; j < groups.length; j++) {
    var g = groups[j];
    if (g.type === 'turn' && g.status === 'pending') {
      g.status = 'incomplete';
      // Estimate duration: last event - first event
      if (g.events.length > 1) {
        var first = g.events[0]._raw && g.events[0]._raw.timestamp;
        var last = g.events[g.events.length - 1]._raw && g.events[g.events.length - 1]._raw.timestamp;
        if (first && last) {
          g.durationMs = new Date(last).getTime() - new Date(first).getTime();
        }
      }
    }
  }
  return groups;
}

/* ─── pairEvents ──────────────────────────────────────────────────────── */

function pairEvents(events) {
  var steps = [];
  // Reset paired markers
  for (var p = 0; p < events.length; p++) { events[p]._paired = false; }

  var i = 0;
  while (i < events.length) {
    var e = events[i];
    var raw = e._raw || {};

    // Skip turn bookends
    if (raw.eventType === 'turn_start' || raw.eventType === 'turn_end') {
      i++;
      continue;
    }

    // Tool pair: look ahead for matching tool_result
    if (raw.eventType === 'tool_call') {
      var paired = null;
      var pairedIdx = -1;
      for (var j = i + 1; j < events.length && j <= i + 5; j++) {
        var nr = events[j]._raw || {};
        if (nr.eventType === 'tool_result' && nr.tool === raw.tool) {
          paired = events[j];
          pairedIdx = j;
          break;
        }
      }
      steps.push({ type: 'tool', call: e, result: paired });
      if (paired) { events[pairedIdx]._paired = true; }
      i++;
      continue;
    }

    // Skip already paired tool results
    if (raw.eventType === 'tool_result' && e._paired) { i++; continue; }

    // LLM pair: look ahead for llm_done
    if (raw.eventType === 'llm_start') {
      var llmDone = null;
      var llmIdx = -1;
      for (var k = i + 1; k < events.length && k <= i + 10; k++) {
        if ((events[k]._raw || {}).eventType === 'llm_done') {
          llmDone = events[k];
          llmIdx = k;
          break;
        }
      }
      steps.push({ type: 'llm', start: e, done: llmDone });
      if (llmDone) { events[llmIdx]._paired = true; }
      i++;
      continue;
    }
    if (raw.eventType === 'llm_done' && e._paired) { i++; continue; }

    // Standalone event
    steps.push({ type: 'event', event: e });
    i++;
  }
  return steps;
}

/* ─── renderStep ──────────────────────────────────────────────────────── */

function renderStep(h, step, key, C, TC, _fs) {
  var icon = '';
  var text = '';
  var dur = '';
  var cls = 'info';

  switch (step.type) {
    case 'tool': {
      var raw = step.call._raw || {};
      icon = _stepIcons.tool;
      var toolName = raw.tool || step.call.text || '?';
      if (step.result) {
        var rr = step.result._raw || {};
        var summary = rr.result || step.result.text || '';
        text = toolName + ' \u2192 ' + _trunc(String(summary), 80);
        dur = _fmtDur(rr.durationMs);
      } else {
        text = toolName + ' \u23F3 \u010Dek\u00E1m\u2026';
      }
      cls = 'tool';
      break;
    }
    case 'llm': {
      var sr = step.start._raw || {};
      icon = _stepIcons.llm;
      var model = sr.model || '?';
      if (step.done) {
        var dr = step.done._raw || {};
        text = model + ' \u2192 ' + (dr.tokensOut || '?') + ' token\u016F';
        dur = _fmtDur(dr.durationMs);
      } else {
        text = model + ' \u2026';
      }
      cls = 'llm';
      break;
    }
    case 'event': {
      var ev = step.event;
      cls = ev.cls || 'info';
      icon = _stepIcons[cls] || _stepIcons.info;
      text = ev.text || '';
      break;
    }
  }

  var textColor = TC[cls] || C.tx2;
  if (cls === 'error') textColor = C.red || '#f87171';
  if (cls === 'sys') textColor = C.tx3;

  return h('div', {
    key: key,
    style: {
      display: 'flex',
      gap: 4,
      padding: '2px 10px',
      fontFamily: C.mono,
      fontSize: _fs(10.5),
      lineHeight: '1.5',
    }
  },
    h('span', { style: { flexShrink: 0, width: 16, textAlign: 'center', fontSize: _fs(10) } }, icon),
    h('span', { style: {
      flex: 1,
      color: textColor,
      fontStyle: cls === 'sys' ? 'italic' : 'normal',
      opacity: cls === 'sys' ? 0.85 : 1,
    } }, text),
    dur ? h('span', { style: { color: C.tx4, fontSize: _fs(10), flexShrink: 0 } }, dur) : null
  );
}

/* ─── renderTurnGroup ─────────────────────────────────────────────────── */

function renderTurnGroup(h, turn, key, isLast, collapsed, onToggle, C, TC, _fs) {
  var steps = pairEvents(turn.events);
  var stepCount = steps.length;

  var statusIcon = turn.status === 'ok' ? '\u2705' :
                   turn.status === 'incomplete' ? '\u23F3' :
                   turn.status === 'cancelled_by_user' ? '\u274C' :
                   turn.status === 'error' ? '\u26A0\uFE0F' :
                   turn.status === 'timeout' ? '\u23F0' : '\u2705';

  var header = h('div', {
    key: key + '-hdr',
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      padding: '4px 10px',
      cursor: 'pointer',
      fontFamily: C.mono,
      fontSize: _fs(11),
      background: collapsed ? C.bg1 : C.bg2,
      userSelect: 'none',
      opacity: collapsed ? 0.75 : 1,
      borderBottom: '1px solid ' + C.border,
    },
    onClick: function() { onToggle(turn.turnId); },
  },
    h('span', { style: { color: C.tx4, width: 12, flexShrink: 0, fontSize: _fs(9) } },
      collapsed ? '\u25B6' : '\u25BC'),
    h('span', { style: { color: C.tx4, fontSize: _fs(9), flexShrink: 0 } },
      'Turn #' + turn.turnNum),
    h('span', { style: {
      color: C.tx2,
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    } }, _trunc(turn.input, 60)),
    h('span', { style: { color: C.tx4, fontSize: _fs(10), flexShrink: 0, display: 'flex', gap: 4 } },
      turn.durationMs ? h('span', null, '(' + _fmtDur(turn.durationMs) + ')') : null,
      h('span', null, statusIcon),
      h('span', null, '[' + stepCount + ' steps]')
    )
  );

  if (collapsed) {
    return h('div', { key: key }, header);
  }

  var body = h('div', {
    key: key + '-body',
    style: { paddingLeft: 18 },
  }, steps.map(function(step, si) {
    return renderStep(h, step, key + '-s' + si, C, TC, _fs);
  }));

  return h('div', { key: key }, header, body);
}

/* ─── renderSystemEntry ───────────────────────────────────────────────── */

function renderSystemEntry(h, event, key, C, _fs) {
  return h('div', {
    key: key,
    style: {
      padding: '3px 10px',
      fontFamily: C.mono,
      fontSize: _fs(10.5),
      color: C.tx4,
      fontStyle: 'italic',
      borderLeft: '3px solid ' + C.border,
    }
  }, event.text || '');
}

/* ─── Main render ─────────────────────────────────────────────────────── */

function render(h, s, C, TC, _fs, _turnCollapsed, onToggle) {
  var log = s.log || [];
  if (log.length === 0) {
    return h('div', {
      style: {
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.tx4,
        fontFamily: C.mono,
        fontSize: _fs(11),
      }
    }, '\u017D\u00E1dn\u00E9 ud\u00E1losti');
  }

  var groups = groupByTurn(log);

  var children = groups.map(function(g, gi) {
    if (g.type === 'system') {
      return renderSystemEntry(h, g.event, 'sys-' + gi, C, _fs);
    }
    var isLast = gi === groups.length - 1;
    var collapsed = !!_turnCollapsed[g.turnId];
    // Auto-expand last (active) turn
    if (isLast && g.status === 'incomplete') collapsed = false;
    return renderTurnGroup(h, g, 'turn-' + gi, isLast, collapsed, onToggle, C, TC, _fs);
  });

  return h('div', { style: { flex: 1, overflowY: 'auto' } }, children);
}

/* ─── Exports ─────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupByTurn: groupByTurn,
    pairEvents: pairEvents,
    render: render,
  };
}
if (typeof window !== 'undefined') {
  window.AgentLogRenderer = {
    groupByTurn: groupByTurn,
    pairEvents: pairEvents,
    render: render,
  };
}
