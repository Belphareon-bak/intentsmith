/**
 * ChatMessage — Renders a single chat message (user, assistant, or system).
 *
 * Chat panel shows ONLY conversation. No logs, no tool calls, no CRE decisions.
 * Just question → answer.
 */

import * as React from 'react';
import { C3Message } from '@c3/protocol';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatMessageProps {
  message: C3Message;
  showIntentBadge?: boolean;
  isStreaming?: boolean;
}

const AVATARS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  system: 'ℹ️',
};

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  showIntentBadge = false,
  isStreaming = false,
}) => {
  return (
    <div className={`c3-msg c3-msg-${message.type}`}>
      <div className="c3-msg-avatar">
        {AVATARS[message.type] || '💬'}
      </div>
      <div className="c3-msg-body">
        <div className="c3-msg-content">
          <MarkdownRenderer content={message.content} />
          {isStreaming && <span className="c3-streaming-cursor" />}
        </div>

        {showIntentBadge && message.metadata?.intent && (
          <span className="c3-msg-intent-badge">
            {message.metadata.intent}
            {message.metadata.confidence != null && (
              <> @ {(message.metadata.confidence * 100).toFixed(0)}%</>
            )}
          </span>
        )}
      </div>
    </div>
  );
};
