/**
 * DiffToolbar — Displays file info, diff stats, and Accept/Reject/Edit buttons.
 * Shown above the Monaco diff editor for each proposal.
 */

import * as React from 'react';
import {
  CodeChangeProposal,
  ProposalStatus,
  UserReviewAction,
} from '../../common/diff-viewer-protocol';

interface DiffToolbarProps {
  proposal: CodeChangeProposal;
  onAction: (action: UserReviewAction) => void;
  disabled: boolean;
}

const STATUS_ICONS: Record<ProposalStatus, string> = {
  pending: '⏳',
  accepted: '✅',
  rejected: '❌',
  edited: '✏️',
};

export const DiffToolbar: React.FC<DiffToolbarProps> = ({
  proposal,
  onAction,
  disabled,
}) => {
  const { filePath, description, stats, status } = proposal;
  const isActioned = status !== 'pending';

  return (
    <div className="intentsmith-diff-toolbar">
      <div className="intentsmith-diff-toolbar-left">
        <span className="intentsmith-diff-toolbar-file">
          {STATUS_ICONS[status]} {filePath}
          {stats.isNew && <span style={{ color: '#4ade80', marginLeft: 6 }}>(new)</span>}
          {stats.isDelete && <span style={{ color: '#f87171', marginLeft: 6 }}>(deleted)</span>}
        </span>

        <div className="intentsmith-diff-toolbar-stats">
          <span className="intentsmith-diff-stat-add">+{stats.additions}</span>
          <span className="intentsmith-diff-stat-del">-{stats.deletions}</span>
        </div>

        {description && (
          <span className="intentsmith-diff-toolbar-desc" title={description}>
            {description}
          </span>
        )}
      </div>

      <div className="intentsmith-diff-toolbar-actions">
        <button
          className="intentsmith-diff-btn accept"
          onClick={() => onAction('accept')}
          disabled={disabled || status === 'accepted'}
          title="Přijmout změnu"
        >
          ✅ Accept
        </button>
        <button
          className="intentsmith-diff-btn edit"
          onClick={() => onAction('edit')}
          disabled={disabled || status === 'edited'}
          title="Editovat navrženou změnu"
        >
          ✏️ Edit
        </button>
        <button
          className="intentsmith-diff-btn reject"
          onClick={() => onAction('reject')}
          disabled={disabled || status === 'rejected'}
          title="Odmítnout změnu"
        >
          ❌ Reject
        </button>
      </div>
    </div>
  );
};
