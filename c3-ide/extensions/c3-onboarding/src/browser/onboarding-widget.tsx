/**
 * C3 Onboarding Widget
 *
 * First-run experience shown when no C3 session exists.
 * Steps: Welcome → Connect → Tour → Ready
 *
 * Stores completion flag in localStorage: c3.onboarding.completed
 * Can be re-triggered via command "C3: Znovu spustit onboarding"
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import { ILogger } from '@theia/core';
import {
  WelcomeStep,
  ConnectStep,
  TourStep,
  ReadyStep,
  ConnectionStatus,
} from './components/OnboardingSteps';

import './styles/onboarding.css';

const STORAGE_KEY = 'c3.onboarding.completed';
const TOTAL_STEPS = 4;

@injectable()
export class C3OnboardingWidget extends ReactWidget {

  static readonly ID = 'c3:onboarding';
  static readonly LABEL = 'C3 Onboarding';

  @inject(ILogger)
  protected readonly logger!: ILogger;

  // ─── State ─────────────────────────────────────────────

  private currentStep: number = 0;
  private backendUrl: string = 'ws://localhost:3001/c3/ws';
  private connectionStatus: ConnectionStatus = 'idle';
  private connectionMessage: string = '';
  private visible: boolean = false;

  /** Callback to save backend URL preference */
  private onCompleteFn?: (backendUrl: string) => void;

  /** Callback to test connection */
  private testConnectionFn?: (url: string) => Promise<boolean>;

  constructor() {
    super();
    this.id = C3OnboardingWidget.ID;
    this.title.label = C3OnboardingWidget.LABEL;
    this.title.closable = false;
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  // ─── Public API ────────────────────────────────────────

  setOnComplete(fn: (backendUrl: string) => void): void {
    this.onCompleteFn = fn;
  }

  setTestConnection(fn: (url: string) => Promise<boolean>): void {
    this.testConnectionFn = fn;
  }

  /**
   * Show onboarding if not completed before.
   */
  shouldShow(): boolean {
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch {
      return true;
    }
  }

  show(): void {
    this.visible = true;
    this.currentStep = 0;
    this.update();
  }

  hide(): void {
    this.visible = false;
    this.update();
  }

  reset(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.show();
  }

  // ─── Actions ───────────────────────────────────────────

  private nextStep = (): void => {
    if (this.currentStep < TOTAL_STEPS - 1) {
      this.currentStep++;
      this.update();
    } else {
      this.complete();
    }
  };

  private prevStep = (): void => {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.update();
    }
  };

  private skip = (): void => {
    this.complete();
  };

  private complete(): void {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch {}
    this.visible = false;
    this.onCompleteFn?.(this.backendUrl);
    this.update();
    this.logger.info('Onboarding completed');
  }

  private handleUrlChange = (url: string): void => {
    this.backendUrl = url;
    this.connectionStatus = 'idle';
    this.update();
  };

  private handleTestConnection = async (): Promise<void> => {
    this.connectionStatus = 'checking';
    this.connectionMessage = 'Připojuji se...';
    this.update();

    try {
      if (this.testConnectionFn) {
        const ok = await this.testConnectionFn(this.backendUrl);
        this.connectionStatus = ok ? 'ok' : 'error';
        this.connectionMessage = ok
          ? 'Připojeno! Backend běží.'
          : 'Nepodařilo se připojit.';
      } else {
        // Simulate connection test
        await new Promise(r => setTimeout(r, 1000));
        this.connectionStatus = 'ok';
        this.connectionMessage = 'Připojeno! (simulace)';
      }
    } catch (err: any) {
      this.connectionStatus = 'error';
      this.connectionMessage = `Chyba: ${err.message}`;
    }

    this.update();
  };

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    if (!this.visible) return null;

    return (
      <div className="c3-onboarding-overlay" onClick={e => {
        if (e.target === e.currentTarget) { /* don't close on overlay click */ }
      }}>
        <div className="c3-onboarding-dialog">
          {/* Header */}
          <div className="c3-onboarding-header">
            <div className="c3-onboarding-logo">⚡</div>
            <h1 className="c3-onboarding-title">C3 Studio</h1>
            <p className="c3-onboarding-subtitle">
              AI-Powered Development Environment
            </p>
          </div>

          {/* Step indicator */}
          <div className="c3-onboarding-steps">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`c3-onboarding-step-dot ${
                  i === this.currentStep ? 'active' :
                  i < this.currentStep ? 'completed' : ''
                }`}
              />
            ))}
          </div>

          {/* Content */}
          <div className="c3-onboarding-content">
            {this.renderStep()}
          </div>

          {/* Footer */}
          <div className="c3-onboarding-footer">
            <button className="c3-onboarding-skip" onClick={this.skip}>
              Přeskočit
            </button>
            <div className="c3-onboarding-nav">
              {this.currentStep > 0 && (
                <button
                  className="c3-onboarding-btn secondary"
                  onClick={this.prevStep}
                >
                  ← Zpět
                </button>
              )}
              <button
                className="c3-onboarding-btn primary"
                onClick={this.nextStep}
              >
                {this.currentStep === TOTAL_STEPS - 1 ? 'Začít! 🚀' : 'Další →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  private renderStep(): React.ReactNode {
    switch (this.currentStep) {
      case 0: return <WelcomeStep />;
      case 1: return (
        <ConnectStep
          url={this.backendUrl}
          onUrlChange={this.handleUrlChange}
          status={this.connectionStatus}
          statusMessage={this.connectionMessage}
          onTest={this.handleTestConnection}
        />
      );
      case 2: return <TourStep />;
      case 3: return <ReadyStep />;
      default: return null;
    }
  }
}
