// C3 Studio — WebSocket Client
// ══════════════════════════════════════════════════════════════════════════════
//
// WS transport layer: connect, handshake, reconnect, channel routing.
// Emits events to C3Bus, never calls render directly.
//
// Protocol (v1):
//   1. Connect to ws://host:port/c3/ws
//   2. Send {type:'hello', protocolVersion:1, ideVersion, features}
//   3. Receive hello_ack or hello_reject
//   4. Channel messages: {channel:'chat'|'agent'|'terminal'|'status'|'workspace'|'control', data:{...}}
//
// ══════════════════════════════════════════════════════════════════════════════

"use strict";

/* Globals expected: C3Bus (from event-bus.js), _sessions, _sessionActive, _backendBase, fetchBackendData */

var _wsReady = false;
var _serverVersion = null;
var _serverFeatures = [];
var _wsRetryCount = 0;
var _wsMaxRetry = 12;
var _wsRetryTimer = null;
var _chatWs = null;
/* Track which session made the last WS request — reliable fallback for routing */
var _lastSendSessionIdx = 0;

/* ─── Session routing ─────────────────────────────────────────────────── */

function _routeToSession(data) {
  /* Route by terminal reqId (most reliable for terminal responses) */
  if (data.reqId && _termReqMap[data.reqId] !== undefined) {
    var termIdx = _termReqMap[data.reqId];
    /* Clean up on terminal completion */
    if (data.type === 'exec_result' || data.type === 'error') delete _termReqMap[data.reqId];
    return termIdx;
  }
  /* Route by conversationId (stable across restarts) */
  var convId = data.conversationId || (data.metadata && data.metadata.conversationId);
  if (convId && typeof _sessions !== 'undefined') {
    for (var i = 0; i < _sessions.length; i++) {
      if (_sessions[i]._convId === convId) return i;
    }
    /* convId present but no session matched — update the sender session's convId */
    if (typeof _sessions[_lastSendSessionIdx] !== 'undefined' && !_sessions[_lastSendSessionIdx]._convId) {
      _sessions[_lastSendSessionIdx]._convId = convId;
    }
  }
  /* Fallback: session that sent the last message (more reliable than _sessionActive) */
  return _lastSendSessionIdx;
}

/* ─── Rehydration after reconnect ─────────────────────────────────────── */

function _rehydrateSessions() {
  if (typeof _sessions === 'undefined') return;
  var _base = (typeof _backendBase !== 'undefined') ? _backendBase : 'http://localhost:3335';

  /* Send rehydrate control message */
  var convIds = [];
  _sessions.forEach(function(s) { if (s._convId) convIds.push(s._convId); });

  if (convIds.length > 0 && _chatWs && _chatWs.readyState === 1) {
    _chatWs.send(JSON.stringify({
      channel: 'control',
      data: { action: 'rehydrate', conversationIds: convIds }
    }));
  }

  /* Re-fetch messages for each session */
  _sessions.forEach(function(s, idx) {
    if (s._convId) {
      fetch(_base + '/api/conversations/' + s._convId + '/messages', { signal: AbortSignal.timeout(5000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var msgs = (data.messages || []).map(function(m) {
          var meta = null;
          try { meta = m.metadata ? JSON.parse(m.metadata) : null; } catch(e) {}
          return { role: m.role, text: m.content, tag: (meta && meta.mode) || 'LLM' };
        });
        if (msgs.length > 0) {
          s.chat.msgs = msgs;
          C3Bus.emit('session:changed', { idx: idx });
        }
      }).catch(function() {});
    }
  });

  /* Refresh entity lists */
  if (typeof fetchBackendData === 'function') fetchBackendData();

  C3Bus.emit('ws:reconnected', {});
}

/* ─── Connect ─────────────────────────────────────────────────────────── */

function _wsConnect() {
  var _base = (typeof _backendBase !== 'undefined') ? _backendBase : 'http://localhost:3335';
  var wsUrl = _base.replace(/^http/, 'ws') + '/c3/ws';

  try {
    _chatWs = new WebSocket(wsUrl);
  } catch (e) {
    console.error('[C3 WS] Failed to create WebSocket:', e);
    return;
  }

  _chatWs.onopen = function() {
    _wsRetryCount = 0;
    /* Hello handshake */
    _chatWs.send(JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      ideVersion: 'c3-studio-0.2.0',
      features: ['workspace', 'terminal', 'merge-preview', 'edit-ask', 'audit']
    }));
  };

  _chatWs.onclose = function() {
    var wasReady = _wsReady;
    _wsReady = false;

    /* Clear stale pending edits — backend session is gone */
    Object.keys(_pendingEdits).forEach(function(k) {
      if (!_pendingEdits[k].resolved) {
        _pendingEdits[k].resolved = true;
        C3Bus.emit('edit:resolved', { reqId: k, action: 'disconnect' });
      }
    });
    _pendingEdits = {};

    C3Bus.emit('ws:disconnected', { wasReady: wasReady });

    /* Exponential backoff reconnect */
    if (_wsRetryCount < _wsMaxRetry) {
      var delay = Math.min(1000 * Math.pow(2, _wsRetryCount), 30000);
      _wsRetryCount++;
      _wsRetryTimer = setTimeout(_wsConnect, delay);
    }
  };

  _chatWs.onerror = function() { /* onclose handles reconnect */ };

  _chatWs.onmessage = function(e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }

    /* ═══ Handshake phase ═══ */
    if (msg.type === 'hello_ack') {
      _wsReady = true;
      _serverVersion = msg.serverVersion || msg.backendVersion || null;
      _serverFeatures = msg.features || [];
      console.log('[C3 WS] Handshake OK — server v' + _serverVersion + ' features=' + JSON.stringify(_serverFeatures));
      C3Bus.emit('ws:ready', { version: _serverVersion, features: _serverFeatures });
      _rehydrateSessions();
      return;
    }
    if (msg.type === 'hello_reject') {
      console.error('[C3 WS] Handshake rejected:', msg.reason);
      return;
    }

    /* ═══ Post-handshake: channel routing ═══ */
    var d = msg.data || {};
    var si = _routeToSession(d);

    switch (msg.channel) {
      case 'chat':
        if (d.type === 'assistant') {
          C3Bus.emit('chat:message', {
            sessionIdx: si,
            content: d.content,
            tag: (d.metadata && d.metadata.mode) || 'LLM',
            metadata: d.metadata || {}
          });
        } else if (d.type === 'system') {
          C3Bus.emit('chat:system', { sessionIdx: si, content: d.content });
        }
        break;

      case 'agent':
        C3Bus.emit('agent:event', { sessionIdx: si, event: d });
        if (d.type === 'edit_request') {
          C3Bus.emit('edit:request', { sessionIdx: si, event: d });
        }
        break;

      case 'terminal':
        C3Bus.emit('terminal:output', { sessionIdx: si, data: d });
        break;

      case 'status':
        C3Bus.emit('status:update', { sessionIdx: si, data: d });
        break;

      case 'workspace':
        C3Bus.emit('workspace:change', { data: d });
        break;

      case 'control':
        if (d.action === 'session_invalid') {
          C3Bus.emit('session:invalid', { sessionId: d.sessionId || d.conversationId });
        }
        break;
    }
  };
}

/* ─── Send helpers ────────────────────────────────────────────────────── */

function wsSend(channel, data) {
  if (_chatWs && _chatWs.readyState === 1 && _wsReady) {
    _chatWs.send(JSON.stringify({ channel: channel, data: data }));
    return true;
  }
  return false;
}

function wsSendChat(content, session, sessionIdx) {
  /* Track sender session for reliable routing of response */
  if (typeof sessionIdx === 'number') _lastSendSessionIdx = sessionIdx;
  var payload = {
    content: content,
    conversationId: session._convId || null,
    editMode: session.chat.editMode || 'auto',
    agentId: session._agentId || null,
    projectId: session._projectId || null
  };
  if (session.chat._pendingAttachments) payload.attachments = session.chat._pendingAttachments;
  return wsSend('chat', payload);
}

/* Track terminal reqId → sessionIdx for reliable response routing */
var _termReqMap = {};  // reqId → sessionIdx

function wsSendTerminal(command, session, sessionIdx) {
  /* Track sender session (same pattern as wsSendChat) */
  if (typeof sessionIdx === 'number') _lastSendSessionIdx = sessionIdx;
  var reqId = 'term-' + Date.now();
  if (typeof sessionIdx === 'number') _termReqMap[reqId] = sessionIdx;
  // Pass project cwd so terminal executes in project dir, not backend cwd
  var cwd = (typeof window !== 'undefined' && window._wtRoot) ? window._wtRoot : undefined;
  return wsSend('terminal', {
    type: 'exec',
    command: command,
    reqId: reqId,
    conversationId: session._convId || null,
    cwd: cwd
  });
}

function wsSendCancel() {
  return wsSend('control', { action: 'cancel' });
}

function wsSendEditApprove(reqId) {
  return wsSend('control', { action: 'edit_approve', requestId: reqId });
}

function wsSendEditReject(reqId) {
  return wsSend('control', { action: 'edit_reject', requestId: reqId });
}

// v85: Sync feature settings to backend (hot-toggle)
function wsSendSyncSettings(settings) {
  return wsSend('control', { action: 'sync_settings', settings: settings });
}

function wsIsReady() { return _wsReady; }
function wsServerVersion() { return _serverVersion; }
function wsServerFeatures() { return _serverFeatures; }
function wsHasFeature(f) { return _serverFeatures.indexOf(f) >= 0; }
function wsDestroy() {
  clearTimeout(_wsRetryTimer);
  _wsMaxRetry = 0;
  if (_chatWs) { try { _chatWs.close(); } catch(e) {} }
}

/* ─── Edit ACK tracking ───────────────────────────────────────────────── */

var _pendingEdits = {};

function trackEditRequest(reqId, file, diff, sessionIdx) {
  _pendingEdits[reqId] = { file: file, diff: diff, sessionIdx: sessionIdx, timestamp: Date.now(), resolved: false };
}

function approveEdit(reqId) {
  var pe = _pendingEdits[reqId];
  if (!pe || pe.resolved) return;
  pe.resolved = true;
  wsSendEditApprove(reqId);
  C3Bus.emit('edit:resolved', { reqId: reqId, action: 'approve' });
  delete _pendingEdits[reqId];
}

function rejectEdit(reqId) {
  var pe = _pendingEdits[reqId];
  if (!pe || pe.resolved) return;
  pe.resolved = true;
  wsSendEditReject(reqId);
  C3Bus.emit('edit:resolved', { reqId: reqId, action: 'reject' });
  delete _pendingEdits[reqId];
}

function cleanupSessionEdits(sessionIdx) {
  Object.keys(_pendingEdits).forEach(function(k) {
    if (_pendingEdits[k].sessionIdx === sessionIdx && !_pendingEdits[k].resolved) {
      rejectEdit(k);
    }
  });
}

/* Timeout: auto-reject stale edit requests (30s) */
setInterval(function() {
  var now = Date.now();
  Object.keys(_pendingEdits).forEach(function(k) {
    if (!_pendingEdits[k].resolved && now - _pendingEdits[k].timestamp > 30000) {
      rejectEdit(k);
    }
  });
}, 5000);

/* ─── Exports ─────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wsConnect: _wsConnect,
    wsSend: wsSend,
    wsSendChat: wsSendChat,
    wsSendTerminal: wsSendTerminal,
    wsSendCancel: wsSendCancel,
    wsSendSyncSettings: wsSendSyncSettings,
    wsIsReady: wsIsReady,
    wsServerVersion: wsServerVersion,
    wsServerFeatures: wsServerFeatures,
    wsHasFeature: wsHasFeature,
    wsDestroy: wsDestroy,
    trackEditRequest: trackEditRequest,
    approveEdit: approveEdit,
    rejectEdit: rejectEdit,
    cleanupSessionEdits: cleanupSessionEdits
  };
}
if (typeof window !== 'undefined') {
  window.C3WS = {
    connect: _wsConnect,
    send: wsSend,
    sendChat: wsSendChat,
    sendTerminal: wsSendTerminal,
    sendCancel: wsSendCancel,
    syncSettings: wsSendSyncSettings,
    isReady: wsIsReady,
    serverVersion: wsServerVersion,
    serverFeatures: wsServerFeatures,
    hasFeature: wsHasFeature,
    destroy: wsDestroy,
    trackEditRequest: trackEditRequest,
    approveEdit: approveEdit,
    rejectEdit: rejectEdit,
    cleanupSessionEdits: cleanupSessionEdits
  };
}
