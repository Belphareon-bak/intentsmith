/**
 * AgentEventRow — Renders a single event in the agent log timeline.
 *
 * Format: [time] [icon] [detail]
 * Example: 14:32:05  🧠  CRE → DESIGN @ 0.92
 */

import * as React from 'react';
import {
  C3AgentEvent,
  AGENT_EVENT_ICONS,
  CREDecisionPayload,
  ToolCallPayload,
  ToolResultPayload,
  GateVerdictPayload,
  LLMStartPayload,
  LLMDonePayload,
  TurnStartPayload,
  TurnEndPayload,
  ErrorPayload,
  StatusChangePayload,
} from '@c3/protocol';

interface AgentEventRowProps {
  event: C3AgentEvent;
}

export const AgentEventRow: React.FC<AgentEventRowProps> = ({ event }) => {
  return (
    <div className={`c3-agent-event c3-agent-${event.type}`}>
      <span className="c3-agent-time">
        {formatTime(event.timestamp)}
      </span>
      <span className="c3-agent-icon">
        {AGENT_EVENT_ICONS[event.type] || '•'}
      </span>
      <span className="c3-agent-detail">
        {renderDetail(event)}
      </span>
    </div>
  );
};

// ─── Time formatting ───────────────────────────────────────

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}

// ─── Detail rendering per event type ───────────────────────

function renderDetail(event: C3AgentEvent): React.ReactNode {
  const p = event.payload as any;

  switch (event.type) {
    case 'turn_start': {
      const payload = p as TurnStartPayload;
      return (
        <>
          <span className="c3-agent-detail-label">TURN START </span>
          <span className="c3-agent-detail-muted">
            &quot;{truncate(payload.input, 60)}&quot;
          </span>
        </>
      );
    }

    case 'turn_end': {
      const payload = p as TurnEndPayload;
      const statusClass = payload.status === 'ok' ? 'c3-gate-ok' :
        payload.status === 'error' ? 'c3-gate-fail' : 'c3-gate-suspicious';
      return (
        <>
          <span className="c3-agent-detail-label">TURN END </span>
          <span className={statusClass}>{payload.status.toUpperCase()}</span>
          <span className="c3-agent-detail-muted"> ({payload.durationMs}ms)</span>
          {payload.error && (
            <span className="c3-gate-fail"> — {payload.error}</span>
          )}
        </>
      );
    }

    case 'cre_decision': {
      const payload = p as CREDecisionPayload;
      return (
        <>
          <span className="c3-agent-detail-label">CRE → </span>
          <span className="c3-agent-detail-value">{payload.intent}</span>
          <span className="c3-agent-detail-muted">
            {' '}@ {(payload.confidence * 100).toFixed(0)}%
          </span>
          {payload.input && (
            <span className="c3-agent-detail-muted">
              {' '}&quot;{truncate(payload.input, 40)}&quot;
            </span>
          )}
        </>
      );
    }

    case 'tool_call': {
      const payload = p as ToolCallPayload;
      return (
        <>
          <span className="c3-agent-detail-label">TOOL → </span>
          <span className="c3-agent-detail-value">{payload.tool}</span>
          {payload.args && Object.keys(payload.args).length > 0 && (
            <span className="c3-agent-detail-muted">
              {' '}{JSON.stringify(payload.args).slice(0, 80)}
            </span>
          )}
        </>
      );
    }

    case 'tool_result': {
      const payload = p as ToolResultPayload;
      return (
        <>
          <span className="c3-agent-detail-label">RESULT ← </span>
          <span className={payload.success ? 'c3-gate-ok' : 'c3-gate-fail'}>
            {payload.tool}
          </span>
          <span className="c3-agent-detail-muted">
            {' '}({payload.durationMs}ms)
          </span>
          {payload.resultSummary && (
            <span className="c3-agent-detail-muted">
              {' '}{truncate(payload.resultSummary, 60)}
            </span>
          )}
        </>
      );
    }

    case 'gate_verdict': {
      const payload = p as GateVerdictPayload;
      return (
        <>
          <span className="c3-agent-detail-label">GATE </span>
          {renderGateBadge('D6.1', payload.d61)}
          {renderGateBadge('D6.2', payload.d62)}
          {renderGateBadge('D6.3', payload.d63)}
          {renderGateBadge('D6.4', payload.d64)}
          {payload.retryCount != null && payload.retryCount > 0 && (
            <span className="c3-gate-suspicious">
              {' '}(retry #{payload.retryCount})
            </span>
          )}
        </>
      );
    }

    case 'llm_start': {
      const payload = p as LLMStartPayload;
      return (
        <>
          <span className="c3-agent-detail-label">LLM START </span>
          <span className="c3-agent-detail-value">{payload.model}</span>
          <span className="c3-agent-detail-muted">
            {' '}({payload.tokensIn} tokens in)
          </span>
        </>
      );
    }

    case 'llm_done': {
      const payload = p as LLMDonePayload;
      return (
        <>
          <span className="c3-agent-detail-label">LLM DONE </span>
          <span className="c3-agent-detail-value">{payload.tokensOut} tokens</span>
          <span className="c3-agent-detail-muted">
            {' '}({(payload.durationMs / 1000).toFixed(1)}s)
          </span>
        </>
      );
    }

    case 'error': {
      const payload = p as ErrorPayload;
      return (
        <>
          <span className="c3-gate-fail">ERROR [{payload.code}]</span>
          <span className="c3-agent-detail-muted"> {payload.message}</span>
          {payload.recoverable && (
            <span className="c3-gate-suspicious"> (recoverable)</span>
          )}
        </>
      );
    }

    case 'status_change': {
      const payload = p as StatusChangePayload;
      return (
        <>
          <span className="c3-agent-detail-label">STATUS </span>
          <span className="c3-agent-detail-muted">{payload.from}</span>
          <span className="c3-agent-detail-label"> → </span>
          <span className="c3-agent-detail-value">{payload.to}</span>
          {payload.reason && (
            <span className="c3-agent-detail-muted"> ({payload.reason})</span>
          )}
        </>
      );
    }

    case 'llm_token':
      // Tokens are not shown in agent log (they go to chat panel)
      return null;

    default:
      return (
        <span className="c3-agent-detail-muted">
          {event.type}: {JSON.stringify(event.payload).slice(0, 100)}
        </span>
      );
  }
}

// ─── Helpers ───────────────────────────────────────────────

function renderGateBadge(
  label: string,
  verdict: string | undefined,
): React.ReactNode {
  if (!verdict) return null;

  const cls = verdict === 'ok' ? 'c3-gate-ok'
    : verdict === 'fail' ? 'c3-gate-fail'
    : 'c3-gate-suspicious';

  return (
    <span className={cls}>
      {' '}{label} {verdict === 'ok' ? '✅' : verdict === 'fail' ? '❌' : '⚠️'}
    </span>
  );
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
