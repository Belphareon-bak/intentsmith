/**
 * ReviewItem — Single file row in the Review Panel list.
 */

import * as React from 'react';
import {
  CodeChangeProposal,
  ProposalStatus,
  UserReviewAction,
} from '@c3/diff-viewer/lib/common/diff-viewer-protocol';

interface ReviewItemProps {
  proposal: CodeChangeProposal;
  active: boolean;
  onClick: () => void;
  onAction: (action: UserReviewAction) => void;
}

const STATUS_ICONS: Record<ProposalStatus, string> = {
  pending: '⏳',
  accepted: '✅',
  rejected: '❌',
  edited: '✏️',
};

export const ReviewItem: React.FC<ReviewItemProps> = ({
  proposal,
  active,
  onClick,
  onAction,
}) => {
  const { filePath, description, stats, status } = proposal;

  // Extract filename from path
  const fileName = filePath.split('/').pop() || filePath;
  const dir = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : '';

  return (
    <div
      className={`c3-review-item ${status} ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <div className="c3-review-item-left">
        <span className="c3-review-item-icon">{STATUS_ICONS[status]}</span>
        <div>
          <div className="c3-review-item-file" title={filePath}>
            {fileName}
            {dir && (
              <span style={{ opacity: 0.5, marginLeft: 4 }}>{dir}/</span>
            )}
          </div>
          {description && (
            <div className="c3-review-item-desc" title={description}>
              {description}
            </div>
          )}
        </div>
      </div>

      <div className="c3-review-item-right">
        <div className="c3-review-item-stats">
          {stats.isNew ? (
            <span style={{ color: '#4ade80' }}>new</span>
          ) : stats.isDelete ? (
            <span style={{ color: '#f87171' }}>del</span>
          ) : (
            <>
              <span style={{ color: '#4ade80' }}>+{stats.additions}</span>
              <span style={{ color: '#f87171' }}>-{stats.deletions}</span>
            </>
          )}
        </div>

        <div className="c3-review-item-actions">
          {status === 'pending' && (
            <>
              <button
                className="c3-review-item-btn"
                onClick={(e) => { e.stopPropagation(); onAction('accept'); }}
                title="Accept"
              >✅</button>
              <button
                className="c3-review-item-btn"
                onClick={(e) => { e.stopPropagation(); onAction('reject'); }}
                title="Reject"
              >❌</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
