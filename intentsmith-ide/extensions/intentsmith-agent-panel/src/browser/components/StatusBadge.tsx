/**
 * StatusBadge — Agent status indicator.
 */

import * as React from 'react';
import { AgentStatus } from '@intentsmith/protocol';

interface StatusBadgeProps {
  status: AgentStatus;
}

const LABELS: Record<AgentStatus, string> = {
  idle: 'IDLE',
  thinking: 'THINKING',
  executing: 'EXECUTING',
  streaming: 'STREAMING',
  error: 'ERROR',
  disconnected: 'OFFLINE',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  return (
    <span className={`intentsmith-status-badge ${status}`}>
      {LABELS[status] || status}
    </span>
  );
};
