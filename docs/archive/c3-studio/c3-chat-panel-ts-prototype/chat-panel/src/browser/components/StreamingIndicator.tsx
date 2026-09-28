/**
 * StreamingIndicator — Typing dots shown while waiting for first LLM token.
 */

import * as React from 'react';

export const StreamingIndicator: React.FC = () => {
  return (
    <div className="c3-msg c3-msg-assistant">
      <div className="c3-msg-avatar">🤖</div>
      <div className="c3-msg-body">
        <div className="c3-streaming-thinking">
          Přemýšlím
          <span className="c3-streaming-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    </div>
  );
};
