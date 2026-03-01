/**
 * Onboarding Step Components
 *
 * Steps:
 *   0. Welcome  — "Vítej v C3 Studio!"
 *   1. Connect  — Backend URL (auto-detect or manual)
 *   2. Features — 4 pilíře: Chat, Projekty, Workeri, Expertízy
 *   3. Tour     — Quick overview: Chat, Agent Log, Terminal
 *   4. Ready    — "Napiš 'Navrhni architekturu...' pro start"
 */

import * as React from 'react';

// ─── Step 0: Welcome ─────────────────────────────────────

export const WelcomeStep: React.FC = () => (
  <div>
    <div className="c3-onboarding-step-title">Vítej v C3 Studio!</div>
    <div className="c3-onboarding-step-text">
      C3 je AI-powered vývojové prostředí, které navrhnne architekturu,
      napíše kód a provede code review — vše v jednom IDE.
    </div>
    <div className="c3-onboarding-step-text">
      Ty popisuješ, co chceš. C3 agent navrhuje, staví a iteruje.
      Ty máš vždy finální slovo.
    </div>
    <div className="c3-onboarding-step-text" style={{ opacity: 0.6 }}>
      Tento průvodce tě provede prvním nastavením.
    </div>
  </div>
);

// ─── Step 1: Connect ─────────────────────────────────────

export type ConnectionStatus = 'idle' | 'checking' | 'ok' | 'error';

interface ConnectStepProps {
  url: string;
  onUrlChange: (url: string) => void;
  status: ConnectionStatus;
  statusMessage: string;
  onTest: () => void;
}

export const ConnectStep: React.FC<ConnectStepProps> = ({
  url,
  onUrlChange,
  status,
  statusMessage,
  onTest,
}) => (
  <div>
    <div className="c3-onboarding-step-title">Připojení k backendu</div>
    <div className="c3-onboarding-step-text">
      C3 Studio potřebuje běžící C3 backend. Zadej URL nebo ponech výchozí.
    </div>

    <div className="c3-onboarding-input-group">
      <label className="c3-onboarding-label">Backend WebSocket URL</label>
      <input
        className="c3-onboarding-input"
        type="text"
        value={url}
        onChange={e => onUrlChange(e.target.value)}
        placeholder="ws://localhost:3001/c3/ws"
      />
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        className="c3-onboarding-btn secondary"
        onClick={onTest}
        disabled={status === 'checking'}
        style={{ padding: '6px 14px', fontSize: 12 }}
      >
        {status === 'checking' ? '⏳ Testuji...' : '🔌 Otestovat připojení'}
      </button>

      {status !== 'idle' && (
        <div className={`c3-onboarding-status ${status}`}>
          {status === 'ok' && '✅'}
          {status === 'error' && '❌'}
          {status === 'checking' && '⏳'}
          {statusMessage}
        </div>
      )}
    </div>
  </div>
);

// ─── Step 2: Key Features ───────────────────────────────

interface FeaturePillar {
  icon: string;
  label: string;
  description: string;
}

const FEATURE_PILLARS: FeaturePillar[] = [
  {
    icon: '💬',
    label: 'Chat',
    description: 'Piš česky nebo anglicky. Agent rozumí kontextu, hledá na webu i v kódu.',
  },
  {
    icon: '📐',
    label: 'Projekty',
    description: 'Lifecycle engine — od specifikace přes build až po code review.',
  },
  {
    icon: '🤖',
    label: 'Workeri',
    description: 'Autonomní agenti pro dlouhodobé úkoly. Monitoruj průběh v Agent Logu.',
  },
  {
    icon: '🧠',
    label: 'Expertízy',
    description: '15 doménových expertíz — od účetnictví po DevOps. Agent vybere automaticky.',
  },
];

export const FeaturesStep: React.FC = () => (
  <div>
    <div className="c3-onboarding-step-title">Klíčové funkce</div>
    <div className="c3-onboarding-step-text" style={{ marginBottom: 12 }}>
      C3 Studio stojí na 4 pilířích:
    </div>
    {FEATURE_PILLARS.map((item, i) => (
      <div key={i} className="c3-onboarding-tour-item">
        <div className="c3-onboarding-tour-icon">{item.icon}</div>
        <div>
          <div className="c3-onboarding-tour-label">{item.label}</div>
          <div className="c3-onboarding-tour-desc">{item.description}</div>
        </div>
      </div>
    ))}
  </div>
);

// ─── Step 3: Tour ────────────────────────────────────────

interface TourItem {
  icon: string;
  label: string;
  description: string;
  shortcut: string;
}

const TOUR_ITEMS: TourItem[] = [
  {
    icon: '💬',
    label: 'Chat',
    description: 'Piš agentovi co chceš — design, build, review. Přirozený jazyk.',
    shortcut: 'Ctrl+Shift+C',
  },
  {
    icon: '📋',
    label: 'Agent Log',
    description: 'Sleduj co agent dělá — LLM volání, shell příkazy, rozhodnutí.',
    shortcut: 'Ctrl+Shift+A',
  },
  {
    icon: '📐',
    label: 'Design Viewer',
    description: 'Vizualizace architektury a sprintů. Read-only — upravuj přes chat.',
    shortcut: 'Ctrl+Shift+D',
  },
  {
    icon: '🔍',
    label: 'Code Review',
    description: 'Agent navrhne změny → ty reviewuješ diff → accept/reject/edit.',
    shortcut: 'Ctrl+Shift+P → "C3: Code Review"',
  },
  {
    icon: '⌨️',
    label: 'Quick Chat',
    description: 'Rychlý vstup odkudkoliv — pošle zprávu přes CRE.',
    shortcut: 'Ctrl+K',
  },
];

export const TourStep: React.FC = () => (
  <div>
    <div className="c3-onboarding-step-title">Rychlý přehled</div>
    {TOUR_ITEMS.map((item, i) => (
      <div key={i} className="c3-onboarding-tour-item">
        <div className="c3-onboarding-tour-icon">{item.icon}</div>
        <div>
          <div className="c3-onboarding-tour-label">{item.label}</div>
          <div className="c3-onboarding-tour-desc">{item.description}</div>
          <div className="c3-onboarding-tour-shortcut">{item.shortcut}</div>
        </div>
      </div>
    ))}
  </div>
);

// ─── Step 3: Ready ───────────────────────────────────────

export const ReadyStep: React.FC = () => (
  <div>
    <div className="c3-onboarding-step-title">Vše připraveno! 🚀</div>
    <div className="c3-onboarding-step-text">
      C3 Studio je nastaveno. Teď začni tvořit.
    </div>
    <div className="c3-onboarding-step-text" style={{ fontWeight: 600 }}>
      Napiš do chatu například:
    </div>
    <div style={{
      background: 'rgba(167, 139, 250, 0.08)',
      border: '1px solid rgba(167, 139, 250, 0.2)',
      borderRadius: 8,
      padding: '12px 16px',
      margin: '12px 0',
      fontStyle: 'italic',
      fontSize: 13,
      lineHeight: 1.6,
    }}>
      "Navrhni architekturu pro mobilní aplikaci na správu VPN tunelů.
      Technický stack: Flutter, WireGuard, SQLite."
    </div>
    <div className="c3-onboarding-step-text" style={{ opacity: 0.6 }}>
      Agent začne DESIGN fází — navrhne architekturu, zeptá se na detaily,
      vytvoří sprint plán. Ty schvaluješ každý krok.
    </div>
  </div>
);
