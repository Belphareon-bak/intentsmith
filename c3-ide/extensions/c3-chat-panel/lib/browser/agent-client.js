// C3 Studio — Agent Client
// ══════════════════════════════════════════════════════════════════════════════
//
// Agent event processing: formats raw agent channel events into displayable
// log entries with type classification and CSS classes.
//
// Subscribes to C3Bus 'agent:event', emits 'agent:log' with formatted entry.
// Tracks per-session executing state.
//
// AgentEventType (from protocol.js):
//   turn_start, turn_end, cre_decision, tool_call, tool_result,
//   llm_start, llm_token, llm_done, gate_verdict, error, status_change
//
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

/* Globals expected: C3Bus (from event-bus.js), _sessions */

var _isExecuting = {};  // sessionIdx → boolean
var _m1ExecutingByConversation = Object.create(null); // conversationId → boolean
var _lastTurnTools = []; // H2: track tools used in current turn
var _suggestionShownForTurn = false; // H2: dedup per turn

/* G2: Hash-based hue for stable agent color */
function _getAgentColor(agentId) {
  var hash = 0;
  for (var i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash) + agentId.charCodeAt(i);
    hash |= 0;
  }
  var hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 70%, 60%)';
}

/* ─── Event type → display mapping ────────────────────────────────────── */

var _eventMap = {
  'turn_start':    { type: 'TURN',  cls: 'info',    label: 'Začátek tahu' },
  'turn_end':      { type: 'TURN',  cls: 'info',    label: 'Konec tahu' },
  'cre_decision':  { type: 'CRE',   cls: 'cre',     label: 'CRE rozhodnutí' },
  'tool_call':     { type: 'TOOL',  cls: 'tool',    label: 'Volání nástroje' },
  'tool_result':   { type: 'TOOL',  cls: 'tool',    label: 'Výsledek nástroje' },
  'llm_start':     { type: 'LLM',   cls: 'llm',     label: 'LLM start' },
  'llm_token':     { type: 'LLM',   cls: 'llm',     label: null },  // skip — too noisy
  'llm_done':      { type: 'LLM',   cls: 'llm',     label: 'LLM dokončen' },
  'gate_verdict':  { type: 'GATE',  cls: 'gate',    label: 'Gate verdict' },
  'error':         { type: 'ERROR', cls: 'error',   label: 'Chyba' },
  'status_change': { type: 'STATUS',cls: 'info',    label: 'Stav' },
  'edit_request':  { type: 'EDIT',  cls: 'edit',    label: 'Žádost o editaci' },
  'system_step':   { type: 'SYS',  cls: 'sys',     label: 'Systém' }
};

/* ─── Format agent event → log entry ──────────────────────────────────── */

function formatAgentEvent(event) {
  var mapping = _eventMap[event.type] || { type: 'UNKNOWN', cls: 'info', label: event.type };

  /* Skip llm_token — too noisy for log */
  if (event.type === 'llm_token') return null;

  var text = '';
  var payload = event.payload || {};

  switch (event.type) {
    case 'turn_start':
      text = 'Tah #' + (payload.turnNumber || '?') + ' zahájen';
      if (payload.message) text += ': ' + _truncate(payload.message, 80);
      break;

    case 'turn_end':
      text = 'Tah dokončen';
      if (payload.status === 'cancelled_by_user') {
        text = 'Tah zrušen uživatelem';
        mapping = { type: 'CANCEL', cls: 'error', label: 'Zrušeno' };
      } else if (payload.status) {
        text += ' — ' + payload.status;
      }
      if (payload.tokensUsed) text += ' (' + payload.tokensUsed + ' tokenů)';
      break;

    case 'cre_decision':
      text = (payload.intent || payload.handler || 'neznámý') + ' → ' + (payload.actionType || payload.reason || '');
      if (payload.confidence) text += ' (' + Math.round(payload.confidence * 100) + '%)';
      break;

    case 'tool_call':
      text = (payload.tool || payload.name || 'nástroj') + '(' + _truncate(JSON.stringify(payload.args || payload.input || {}), 60) + ')';
      break;

    case 'tool_result':
      var resultText = payload.result || payload.output || '';
      if (typeof resultText === 'object') resultText = JSON.stringify(resultText);
      text = (payload.tool || payload.name || 'nástroj') + ' → ' + _truncate(String(resultText), 100);
      if (payload.exitCode !== undefined) text += ' [exit ' + payload.exitCode + ']';
      break;

    case 'llm_start':
      text = 'Model: ' + (payload.model || '?');
      if (payload.temperature !== undefined) text += ' temp=' + payload.temperature;
      break;

    case 'llm_done':
      text = 'Odpověď dokončena';
      if (payload.tokens) text += ' (' + payload.tokens + ' tokenů)';
      if (payload.duration) text += ' za ' + payload.duration + 'ms';
      break;

    case 'gate_verdict':
      text = ((payload.ok !== undefined ? payload.ok : payload.passed) ? '✓ Schváleno' : '✗ Zamítnuto');
      if (payload.dimension) text += ' — ' + payload.dimension;
      else if (payload.reason) text += ' — ' + payload.reason;
      if (payload.score !== undefined) text += ' (skóre: ' + payload.score + ')';
      break;

    case 'error':
      text = payload.message || payload.error || 'Neznámá chyba';
      if (payload.code) text = '[' + payload.code + '] ' + text;
      break;

    case 'status_change':
      text = (payload.from || '?') + ' → ' + (payload.to || '?');
      break;

    case 'edit_request':
      text = (payload.file || '?') + ' — čeká na schválení';
      break;

    case 'system_step':
      /* Model upgrade steps belong in Upgrady view, not agent log */
      if (payload.step === 'model_upgrade' || payload.step === 'model_cleanup' ||
          payload.step === 'model_loading' || payload.step === 'model_applied' ||
          payload.step === 'model_deleted') return null;
      var _stepLabels = {
        handler_selected: 'Režim',
        cre_decided: 'Rozhodnutí',
        routing_switch: 'Směrování',
        code_analysis_start: 'Analýza kódu',
        code_analysis_search: 'Hledám v kódu',
        code_analysis_context: 'Stavím kontext',
        code_analysis_llm: 'LLM syntéza',
        prompt_built: 'Prompt sestaven',
        quality_links: 'Kontrola odkazů',
        quality_numeric: 'Kontrola čísel',
        quality_fluff: 'Kontrola kvality',
        quality_d6: 'Kvalitní brána',
        quality_lang: 'Kontrola jazyka',
        specialist_dispatch: 'Specialista',
        expertise_discovery: 'Expertíza',
        attachment_guard: 'Přílohy',
        lifecycle: 'Životní cyklus',
        build_handoff: 'Stavba projektu',
        session_resume: 'Obnova sezení',
        agent_wizard: 'Průvodce',
        llm_calling: 'Volám LLM',
        llm_response: 'Odpověď hotova',
        preparing_prompt: 'Připravuji prompt',
        analyzing_input: 'Analyzuji dotaz',
        search_start: 'Hledám na webu',
        search_scrape: 'Stahuji stránky',
        search_synthesis: 'Tvořím odpověď',
        tool_executing: 'Spouštím nástroj'
      };
      var stepLabel = _stepLabels[payload.step] || payload.step || '?';
      text = stepLabel + (payload.detail ? ' — ' + payload.detail : '');
      break;

    default:
      text = JSON.stringify(payload).substring(0, 120);
  }

  return {
    time: _formatTime(event.timestamp),
    ts: event.timestamp || new Date().toISOString(),
    type: mapping.type,
    cls: mapping.cls,
    text: text,
    active: true,
    seq: event.seq || 0,
    turnId: event.turnId || null,
    eventId: event.id || null,
    agent: event.agentId || null,  // G2: agent badge
    _raw: {
      eventType: event.type,
      tool: payload.tool || payload.name || null,
      args: payload.args || payload.input || null,
      success: payload.success,
      durationMs: payload.durationMs || payload.duration || null,
      model: payload.model || null,
      tokensIn: payload.tokensIn || null,
      tokensOut: payload.tokensOut || payload.tokens || null,
      intent: payload.intent || payload.handler || null,
      confidence: payload.confidence || null,
      input: payload.input || payload.message || null,
      status: payload.status || null,
      step: payload.step || null,
      detail: payload.detail || null,
      result: payload.result || payload.output || null,
      timestamp: event.timestamp || new Date().toISOString(),
      callId: payload.callId || null
    }
  };
}

/* ─── Bus subscriber ──────────────────────────────────────────────────── */

function initAgentClient() {
  if (typeof C3Bus === 'undefined') {
    console.error('[C3 Agent] C3Bus not available');
    return;
  }

  C3Bus.on('agent:event', function(ev) {
    var sessionIdx = ev.sessionIdx;
    var event = ev.event || {};
    var isM1Event = event.transport === 'm1'
      && typeof event.conversationId === 'string'
      && event.conversationId.length > 0;

    /* Track executing state */
    if (event.type === 'turn_start') {
      if (isM1Event) _m1ExecutingByConversation[event.conversationId] = true;
      else _isExecuting[sessionIdx] = true;
      _lastTurnTools = [];
      _suggestionShownForTurn = false;
    } else if (event.type === 'turn_end' || event.type === 'error') {
      /* M1 completion is authoritative only at chat:terminal. A progress event
         named error/turn_end must not hide STOP before that terminal arrives. */
      if (!isM1Event) _isExecuting[sessionIdx] = false;

      /* H2: Smart suggestion — if file was edited and package.json has test script */
      if (event.type === 'turn_end' && !_suggestionShownForTurn) {
        var hadEdit = _lastTurnTools.some(function(t) { return t === 'fs.write' || t === 'fs.patch'; });
        if (hadEdit) {
          _suggestionShownForTurn = true;
          var _base = (typeof _backendBase !== 'undefined') ? _backendBase : (function(){try{if(typeof window!=='undefined'&&window.electronC3){var u=window.electronC3.getBackendUrl();if(u)return u;}}catch(e){}return 'http://127.0.0.1:3335';})();
          fetch(_base + '/api/workspace/file?path=package.json', { signal: AbortSignal.timeout(2000) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            try {
              var pkg = JSON.parse(data.content);
              if (pkg.scripts && pkg.scripts.test) {
                C3Bus.emit('suggestion:show', {
                  sessionIdx: sessionIdx,
                  text: 'Spustit testy? (' + pkg.scripts.test.substring(0, 30) + ')',
                  action: function() {
                    if (typeof C3Terminal !== 'undefined') C3Terminal.send(sessionIdx, 'npm test');
                  }
                });
              }
            } catch (ex) {}
          }).catch(function() {});
        }
      }
      _lastTurnTools = [];
    }

    /* H2: Track tools used in current turn */
    if (event.type === 'tool_call' && event.payload) {
      _lastTurnTools.push(event.payload.tool || event.payload.name || '');
    }

    /* Format and emit */
    var logEntry = formatAgentEvent(event);
    if (logEntry) {
      C3Bus.emit('agent:log', { sessionIdx: sessionIdx, entry: logEntry });
    }
  });

  /* Status updates can also affect executing state */
  C3Bus.on('status:update', function(ev) {
    if (ev.transport !== 'm1' && ev.data && ev.data.agentStatus) {
      var si = ev.sessionIdx !== undefined ? ev.sessionIdx : 0;
      _isExecuting[si] = (ev.data.agentStatus === 'executing');
    }
  });

  /* Canonical M1 chat terminals replace legacy agent turn_end/error events. */
  C3Bus.on('chat:terminal', function(ev) {
    if (ev && ev.action === 'send' && Number.isSafeInteger(ev.sessionIdx)) {
      _isExecuting[ev.sessionIdx] = false;
      if (typeof ev.conversationId === 'string' && ev.conversationId.length > 0) {
        _m1ExecutingByConversation[ev.conversationId] = false;
      }
      C3Bus.emit('agent:state', {
        sessionIdx: ev.sessionIdx,
        conversationId: ev.conversationId || null,
        executing: false
      });
    }
  });

  /* Reset all executing state on WS disconnect — prevents dead state */
  C3Bus.on('ws:disconnected', function() {
    _isExecuting = {};
    _m1ExecutingByConversation = Object.create(null);
    C3Bus.emit('agent:state', {
      sessionIdx: null,
      conversationId: null,
      executing: false
    });
  });
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function _truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + '…';
}

function _formatTime(isoStr) {
  if (!isoStr) return new Date().toLocaleTimeString('cs-CZ');
  try {
    return new Date(isoStr).toLocaleTimeString('cs-CZ');
  } catch (e) {
    return isoStr;
  }
}

function isAgentExecuting(sessionIdx) {
  var session = typeof _sessions !== 'undefined' ? _sessions[sessionIdx] : null;
  var conversationId = session && session._convId;
  if (
    typeof conversationId === 'string'
    && Object.prototype.hasOwnProperty.call(_m1ExecutingByConversation, conversationId)
  ) return _m1ExecutingByConversation[conversationId] === true;
  return !!_isExecuting[sessionIdx];
}

/* ─── Exports ─────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initAgentClient: initAgentClient,
    formatAgentEvent: formatAgentEvent,
    isAgentExecuting: isAgentExecuting,
    getAgentColor: _getAgentColor
  };
}
if (typeof window !== 'undefined') {
  window.C3Agent = {
    init: initAgentClient,
    formatEvent: formatAgentEvent,
    isExecuting: isAgentExecuting,
    getAgentColor: _getAgentColor
  };
}
