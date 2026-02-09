/**
 * EventFilter — Toggle buttons for agent log event filtering.
 */

import * as React from 'react';
import { AgentEventType } from '@c3/protocol';

export interface FilterState {
  cre: boolean;
  tools: boolean;
  gate: boolean;
  llm: boolean;
  errors: boolean;
  turns: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  cre: true,
  tools: true,
  gate: true,
  llm: true,
  errors: true,
  turns: true,
};

/** Maps event type to filter category */
export function getFilterCategory(type: AgentEventType): keyof FilterState {
  switch (type) {
    case 'cre_decision': return 'cre';
    case 'tool_call':
    case 'tool_result': return 'tools';
    case 'gate_verdict': return 'gate';
    case 'llm_start':
    case 'llm_token':
    case 'llm_done': return 'llm';
    case 'error': return 'errors';
    case 'turn_start':
    case 'turn_end': return 'turns';
    case 'status_change': return 'cre';
    default: return 'cre';
  }
}

interface EventFilterProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onClear: () => void;
  eventCount: number;
}

const FILTER_LABELS: Record<keyof FilterState, string> = {
  cre: 'CRE',
  tools: 'Tools',
  gate: 'Gate',
  llm: 'LLM',
  errors: 'Errors',
  turns: 'Turns',
};

export const EventFilter: React.FC<EventFilterProps> = ({
  filters,
  onChange,
  onClear,
  eventCount,
}) => {
  const toggle = (key: keyof FilterState) => {
    onChange({ ...filters, [key]: !filters[key] });
  };

  return (
    <div className="c3-agent-header-right">
      {(Object.keys(FILTER_LABELS) as Array<keyof FilterState>).map(key => (
        <button
          key={key}
          className={`c3-filter-btn ${filters[key] ? 'active' : ''}`}
          onClick={() => toggle(key)}
          title={`${filters[key] ? 'Skrýt' : 'Zobrazit'} ${FILTER_LABELS[key]}`}
        >
          {FILTER_LABELS[key]}
        </button>
      ))}

      {eventCount > 0 && (
        <button
          className="c3-filter-clear"
          onClick={onClear}
          title="Vyčistit log"
        >
          ✕
        </button>
      )}
    </div>
  );
};
