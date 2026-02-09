/**
 * C3 Review Panel Widget
 *
 * Shows the list of proposed changes from the agent.
 * Each change can be individually reviewed (accept/reject/edit).
 *
 * Features:
 *   - Clickable file list (opens Monaco diff)
 *   - Per-file Accept/Reject inline
 *   - Accept All / Reject All bulk actions
 *   - "Apply" button (writes accepted changes + auto-commit)
 *   - Progress bar showing review completion
 *   - Auto-opens on PENDING_REVIEW phase
 *   - Persists across IDE restarts via project.json
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { CommandRegistry } from '@theia/core';
import {
  C3DiffViewer,
  ChangeSet,
  CodeChangeProposal,
  UserReviewAction,
  ProposalStatus,
} from '../../../diff-viewer/src/common/diff-viewer-protocol';
import { C3DiffProposalManager } from '../../../diff-viewer/src/browser/diff-proposal-manager';
import { ReviewItem } from './components/ReviewItem';
import { REVIEW_PANEL_WIDGET_ID } from '../common/review-panel-protocol';

import './styles/review-panel.css';

@injectable()
export class C3ReviewPanelWidget extends ReactWidget {

  static readonly ID = REVIEW_PANEL_WIDGET_ID;
  static readonly LABEL = 'Code Review';

  @inject(C3DiffViewer)
  protected readonly diffService!: C3DiffViewer;

  @inject(C3DiffProposalManager)
  protected readonly diffManager!: C3DiffProposalManager;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  @inject(CommandRegistry)
  protected readonly commandRegistry!: CommandRegistry;

  // ─── State ─────────────────────────────────────────────

  private changeSet: ChangeSet | null = null;
  private activeProposalId: string | null = null;
  private applying: boolean = false;
  private projectPath: string = '';

  constructor() {
    super();
    this.id = C3ReviewPanelWidget.ID;
    this.title.label = C3ReviewPanelWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-git-pull-request';
    this.addClass('c3-review-panel');
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  // ─── Public API ────────────────────────────────────────

  /**
   * Load and display a change set.
   * Called when:
   * - Agent creates new change set
   * - IDE starts with pending_review phase
   */
  async loadChangeSet(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    this.diffManager.setProjectPath(projectPath);

    this.changeSet = await this.diffService.loadChangeSet(projectPath);
    this.activeProposalId = null;
    this.update();
  }

  setChangeSet(cs: ChangeSet): void {
    this.changeSet = cs;
    this.activeProposalId = null;
    this.update();
  }

  // ─── Actions ───────────────────────────────────────────

  private handleProposalClick = (proposal: CodeChangeProposal): void => {
    this.activeProposalId = proposal.id;
    this.update();

    // Open diff editor
    this.diffManager.openDiff(proposal).then(action => {
      this.handleProposalAction(proposal.id, action);
    });
  };

  private handleProposalAction = async (
    proposalId: string,
    action: UserReviewAction,
  ): Promise<void> => {
    if (!this.changeSet) return;

    let status: ProposalStatus;
    switch (action) {
      case 'accept': status = 'accepted'; break;
      case 'reject': status = 'rejected'; break;
      case 'edit':   status = 'edited';   break;
    }

    try {
      this.changeSet = await this.diffService.updateProposalStatus(
        this.projectPath,
        proposalId,
        status,
      );
      this.update();
    } catch (err: any) {
      this.messageService.error(`Chyba: ${err.message}`);
    }
  };

  private handleAcceptAll = async (): Promise<void> => {
    if (!this.changeSet) return;

    for (const p of this.changeSet.proposals) {
      if (p.status === 'pending') {
        this.changeSet = await this.diffService.updateProposalStatus(
          this.projectPath,
          p.id,
          'accepted',
        );
      }
    }
    this.update();
  };

  private handleRejectAll = async (): Promise<void> => {
    if (!this.changeSet) return;

    const confirmed = await this.messageService.warn(
      'Odmítnout všechny navržené změny?',
      'Odmítnout vše',
      'Zrušit',
    );
    if (confirmed !== 'Odmítnout vše') return;

    await this.diffService.rejectAll(this.projectPath);
    this.changeSet = await this.diffService.loadChangeSet(this.projectPath);
    this.update();
  };

  private handleApply = async (): Promise<void> => {
    if (!this.changeSet || this.applying) return;

    this.applying = true;
    this.update();

    try {
      const result = await this.diffService.applyAccepted(this.projectPath);

      const summary = [
        result.applied && `${result.applied} applied`,
        result.edited && `${result.edited} edited`,
        result.rejected && `${result.rejected} rejected`,
      ].filter(Boolean).join(', ');

      this.messageService.info(`✅ Changes applied: ${summary}`);

      if (result.commitHash) {
        this.messageService.info(`📝 Auto-committed: ${result.commitHash.slice(0, 8)}`);
      }

      // Reload to show updated status
      this.changeSet = await this.diffService.loadChangeSet(this.projectPath);
    } catch (err: any) {
      this.messageService.error(`Chyba při aplikování: ${err.message}`);
    } finally {
      this.applying = false;
      this.update();
    }
  };

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    if (!this.changeSet) {
      return (
        <div className="c3-review-empty">
          <div className="c3-review-empty-icon">🔍</div>
          <div>Žádné změny k review.</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>
            Agent navrhne změny během BUILD fáze.
          </div>
        </div>
      );
    }

    const { proposals, label, status } = this.changeSet;
    const total = proposals.length;
    const reviewed = proposals.filter(p => p.status !== 'pending').length;
    const accepted = proposals.filter(p => p.status === 'accepted' || p.status === 'edited').length;
    const hasPending = proposals.some(p => p.status === 'pending');
    const canApply = !hasPending && accepted > 0 && status !== 'applied';

    const progressPct = total > 0 ? (reviewed / total) * 100 : 0;

    return (
      <div className="c3-review-container">
        {/* Header */}
        <div className="c3-review-header">
          <span className="c3-review-title">🔍 {label}</span>
          <span className="c3-review-progress">
            {reviewed}/{total} reviewed
          </span>
        </div>

        {/* Progress bar */}
        <div className="c3-review-progress-bar">
          <div
            className={`c3-review-progress-fill ${reviewed === total ? 'complete' : 'partial'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* File list */}
        <div className="c3-review-list">
          {proposals.map(proposal => (
            <ReviewItem
              key={proposal.id}
              proposal={proposal}
              active={proposal.id === this.activeProposalId}
              onClick={() => this.handleProposalClick(proposal)}
              onAction={(action) => this.handleProposalAction(proposal.id, action)}
            />
          ))}
        </div>

        {/* Footer with bulk actions */}
        <div className="c3-review-footer">
          <div className="c3-review-footer-actions">
            <button
              className="c3-review-footer-btn accept-all"
              onClick={this.handleAcceptAll}
              disabled={!hasPending || status === 'applied'}
            >
              ✅ Accept All
            </button>
            <button
              className="c3-review-footer-btn reject-all"
              onClick={this.handleRejectAll}
              disabled={status === 'applied'}
            >
              ❌ Reject All
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {status === 'applied' && (
              <span className="c3-review-footer-status">
                ✅ Změny aplikovány
              </span>
            )}

            <button
              className="c3-review-footer-btn apply"
              onClick={this.handleApply}
              disabled={!canApply || this.applying}
            >
              {this.applying ? '⏳ Aplikuji...' : '🚀 Apply Changes'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
