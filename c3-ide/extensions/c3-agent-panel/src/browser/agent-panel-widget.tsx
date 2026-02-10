/**
 * C3 Agent Log Panel Widget — Theia ReactWidget
 *
 * Shows real-time CRE decisions, tool calls, gate verdicts, status.
 * Sorted by `seq` (monotonic counter), NOT timestamp.
 *
 * This is the "what agent is doing" panel.
 * Chat panel is the "what agent said" panel — they are separate.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import { C3BackendBridgeProxy } from '@c3/backend-bridge/lib/browser/backend-bridge-proxy';
import { C3AgentEvent, AgentStatus, AGENT_LOG } from '@c3/protocol';
import { AgentEventRow } from './components/AgentEventRow';
import { StatusBadge } from './components/StatusBadge';
import {
  EventFilter,
  FilterState,
  DEFAULT_FILTERS,
  getFilterCategory,
} from './components/EventFilter';

import './styles/agent-panel.css';

@injectable()
export class C3AgentPanelWidget extends ReactWidget {

  static readonly ID = 'c3:agent-panel';
  static readonly LABEL = 'Agent Log';

  @inject(C3BackendBridgeProxy)
  protected readonly bridge!: C3BackendBridgeProxy;

  // ─── State ─────────────────────────────────────────────

  private events: C3AgentEvent[] = [];
  private agentStatus: AgentStatus = 'idle';
  private filters: FilterState = { ...DEFAULT_FILTERS };
  private autoScroll: boolean = true;
  private logEndRef: HTMLDivElement | null = null;
  private logContainerRef: HTMLDivElement | null = null;

  constructor() {
    super();
    this.id = C3AgentPanelWidget.ID;
    this.title.label = C3AgentPanelWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-output';
    this.addClass('c3-agent-panel');
  }

  @postConstruct()
  protected init(): void {
    this.subscribeToEvents();
    this.update();
  }

  // ─── Event Subscriptions ───────────────────────────────

  private subscribeToEvents(): void {
    this.bridge.onAgentEvent(event => {
      // Skip llm_token events (they go to chat panel, not agent log)
      if (event.type === 'llm_token') return;

      // Insert sorted by seq (should already be in order, but be safe)
      this.insertSorted(event);

      // Trim if too many events
      if (this.events.length > AGENT_LOG.MAX_VISIBLE_EVENTS) {
        this.events = this.events.slice(-AGENT_LOG.MAX_VISIBLE_EVENTS);
      }

      // Track agent status
      this.updateStatusFromEvent(event);

      this.update();

      if (this.autoScroll) {
        this.scrollToBottom();
      }
    });

    this.bridge.onConnectionChange(status => {
      if (status.agentStatus) {
        this.agentStatus = status.agentStatus;
      }
      if (status.state === 'disconnected') {
        this.agentStatus = 'disconnected';
      }
      this.update();
    });
  }

  private insertSorted(event: C3AgentEvent): void {
    // Fast path: event seq is larger than last → append
    if (this.events.length === 0 || event.seq > this.events[this.events.length - 1].seq) {
      this.events.push(event);
      return;
    }

    // Slow path: binary search for correct position (shouldn't happen normally)
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid].seq < event.seq) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Skip duplicates
    if (lo < this.events.length && this.events[lo].seq === event.seq) return;

    this.events.splice(lo, 0, event);
  }

  private updateStatusFromEvent(event: C3AgentEvent): void {
    switch (event.type) {
      case 'turn_start':
        this.agentStatus = 'thinking';
        break;
      case 'llm_start':
        this.agentStatus = 'streaming';
        break;
      case 'tool_call':
        this.agentStatus = 'executing';
        break;
      case 'turn_end':
        this.agentStatus = 'idle';
        break;
      case 'error':
        this.agentStatus = 'error';
        break;
    }
  }

  // ─── Filtering ─────────────────────────────────────────

  private getFilteredEvents(): C3AgentEvent[] {
    return this.events.filter(event => {
      const category = getFilterCategory(event.type);
      return this.filters[category];
    });
  }

  private handleFilterChange = (newFilters: FilterState): void => {
    this.filters = newFilters;
    this.update();
  };

  private handleClear = (): void => {
    this.events = [];
    this.update();
  };

  // ─── Auto-scroll ───────────────────────────────────────

  private handleScroll = (): void => {
    const el = this.logContainerRef;
    if (!el) return;

    // If user scrolled up more than threshold, disable auto-scroll
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.autoScroll = distanceFromBottom < AGENT_LOG.AUTO_SCROLL_THRESHOLD_PX;
  };

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.logEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    const filtered = this.getFilteredEvents();

    return (
      <div className="c3-agent-container">
        {/* Header: status badge + filters */}
        <div className="c3-agent-header">
          <div className="c3-agent-header-left">
            <StatusBadge status={this.agentStatus} />
            <span className="c3-agent-detail-muted">
              {filtered.length}/{this.events.length} events
            </span>
          </div>

          <EventFilter
            filters={this.filters}
            onChange={this.handleFilterChange}
            onClear={this.handleClear}
            eventCount={this.events.length}
          />
        </div>

        {/* Event timeline */}
        <div
          className="c3-agent-log"
          ref={el => { this.logContainerRef = el; }}
          onScroll={this.handleScroll}
        >
          {filtered.length === 0 ? (
            <div className="c3-agent-empty">
              {this.events.length === 0
                ? 'Agent idle — čekám na příkaz.'
                : 'Žádné eventy pro aktuální filtry.'
              }
            </div>
          ) : (
            filtered.map(event => (
              <AgentEventRow key={`${event.seq}-${event.id}`} event={event} />
            ))
          )}

          <div ref={el => { this.logEndRef = el; }} />
        </div>
      </div>
    );
  }
}
