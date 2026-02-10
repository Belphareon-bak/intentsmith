/**
 * C3 Token Dashboard Widget
 *
 * Displays token usage statistics with intent breakdown and daily chart.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │ 📊 Token Usage                   │
 *   ├──────────────────────────────────┤
 *   │ Dnes:     12,450 tokenů          │
 *   │ Týden:    87,230 tokenů          │
 *   │ Projekt: 145,800 tokenů          │
 *   │ Cena:     ~$2.34                 │
 *   ├──────────────────────────────────┤
 *   │ Podle intentu:                   │
 *   │ DESIGN       45% ████████░░     │
 *   │ CODE         30% ██████░░░░     │
 *   │ CONVERSATIONAL 25% █████░░░░    │
 *   ├──────────────────────────────────┤
 *   │ Denní přehled (posledních 30 dní)│
 *   │ ▁▂▃▄▅▆▇█▅▃▂▁▂▃▅▇▆▅▃▂▁▁▂▃▄▅▆▇█ │
 *   └──────────────────────────────────┘
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import {
  C3TokenDashboard,
  TokenStats,
  IntentBreakdown,
  DailyUsage,
} from '../../common/token-dashboard-protocol';

import '../styles/token-dashboard.css';

const WIDGET_ID = 'c3:token-dashboard';

const INTENT_COLORS: Record<string, string> = {
  DESIGN: '#a78bfa',
  CODE: '#60a5fa',
  BUILD: '#60a5fa',
  CONVERSATIONAL: '#4ade80',
  REVIEW: '#facc15',
  UNKNOWN: '#94a3b8',
};

@injectable()
export class C3TokenDashboardWidget extends ReactWidget {

  static readonly ID = WIDGET_ID;
  static readonly LABEL = 'Token Usage';

  @inject(C3TokenDashboard)
  protected readonly dashboardService!: C3TokenDashboard;

  private stats: TokenStats | null = null;
  private currentProject: string | undefined;
  private loading = false;

  constructor() {
    super();
    this.id = C3TokenDashboardWidget.ID;
    this.title.label = C3TokenDashboardWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-graph';
    this.addClass('c3-token-dashboard');
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  async refresh(projectSlug?: string): Promise<void> {
    this.currentProject = projectSlug;
    this.loading = true;
    this.update();

    try {
      this.stats = await this.dashboardService.getStats(projectSlug);
    } catch { this.stats = null; }

    this.loading = false;
    this.update();
  }

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    if (this.loading) {
      return <div className="c3-token-empty">⏳ Načítám statistiky...</div>;
    }

    if (!this.stats) {
      return (
        <div className="c3-token-empty">
          <div className="c3-token-empty-icon">📊</div>
          <div>Žádná data o spotřebě tokenů.</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>
            Data se budou sbírat automaticky.
          </div>
        </div>
      );
    }

    return (
      <div className="c3-token-container">
        <SummaryCards stats={this.stats} />
        <IntentChart intents={this.stats.byIntent} />
        <DailyChart daily={this.stats.dailyUsage} />
      </div>
    );
  }
}

// ─── Summary Cards ───────────────────────────────────────

const SummaryCards: React.FC<{ stats: TokenStats }> = ({ stats }) => (
  <div className="c3-token-summary">
    <div className="c3-token-card">
      <div className="c3-token-card-label">Dnes</div>
      <div className="c3-token-card-value">{formatNumber(stats.today)}</div>
    </div>
    <div className="c3-token-card">
      <div className="c3-token-card-label">Tento týden</div>
      <div className="c3-token-card-value">{formatNumber(stats.thisWeek)}</div>
    </div>
    <div className="c3-token-card">
      <div className="c3-token-card-label">Projekt celkem</div>
      <div className="c3-token-card-value">{formatNumber(stats.project)}</div>
    </div>
    <div className="c3-token-card">
      <div className="c3-token-card-label">Odhadovaná cena</div>
      <div className="c3-token-card-value c3-token-cost">
        ~${stats.estimatedCostUsd.toFixed(2)}
      </div>
    </div>
  </div>
);

// ─── Intent Breakdown Chart ──────────────────────────────

const IntentChart: React.FC<{ intents: IntentBreakdown[] }> = ({ intents }) => {
  if (intents.length === 0) return null;

  return (
    <div className="c3-token-section">
      <div className="c3-token-section-title">Podle intentu</div>
      {intents.map(intent => (
        <div key={intent.intent} className="c3-token-intent-row">
          <div className="c3-token-intent-label">
            <span className="c3-token-intent-dot"
              style={{ background: INTENT_COLORS[intent.intent] || '#94a3b8' }}
            />
            {intent.intent}
          </div>
          <div className="c3-token-intent-bar-container">
            <div
              className="c3-token-intent-bar"
              style={{
                width: `${Math.max(2, intent.percentage)}%`,
                background: INTENT_COLORS[intent.intent] || '#94a3b8',
              }}
            />
          </div>
          <div className="c3-token-intent-pct">
            {intent.percentage.toFixed(0)}%
          </div>
          <div className="c3-token-intent-tokens">
            {formatNumber(intent.tokens)}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Daily Chart (sparkline) ─────────────────────────────

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

const DailyChart: React.FC<{ daily: DailyUsage[] }> = ({ daily }) => {
  if (daily.length === 0) return null;

  const max = Math.max(...daily.map(d => d.tokens), 1);
  const sparkline = daily.map(d => {
    const idx = Math.round((d.tokens / max) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx];
  }).join('');

  const totalTurns = daily.reduce((s, d) => s + d.turns, 0);

  return (
    <div className="c3-token-section">
      <div className="c3-token-section-title">
        Posledních {daily.length} dní ({totalTurns} turnů)
      </div>
      <div className="c3-token-sparkline">{sparkline}</div>
      <div className="c3-token-sparkline-labels">
        <span>{daily[0]?.date}</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
};

// ─── Helpers ─────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toString();
}
