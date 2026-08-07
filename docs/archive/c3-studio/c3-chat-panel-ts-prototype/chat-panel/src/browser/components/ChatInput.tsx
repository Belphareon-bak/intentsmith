/**
 * ChatInput — Chat input with auto-resize, history recall, send/cancel.
 *
 * Enter = send, Shift+Enter = newline, Ctrl+Up = previous message.
 * Disabled during agent execution. Cancel button when streaming.
 */

import * as React from 'react';
import { CHAT } from '@c3/protocol';

interface ChatInputProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  isProcessing: boolean;
  isStreaming: boolean;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onCancel,
  isProcessing,
  isStreaming,
  disabled = false,
}) => {
  const [value, setValue] = React.useState('');
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  React.useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [value]);

  // Focus on mount
  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = React.useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isProcessing || disabled) return;

    // Add to history
    setHistory(prev => [...prev.slice(-CHAT.MAX_HISTORY_RECALL), trimmed]);
    setHistoryIndex(-1);

    onSend(trimmed);
    setValue('');
  }, [value, isProcessing, disabled, onSend]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    // Enter = send (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Ctrl+Up = history recall
    if (e.key === 'ArrowUp' && e.ctrlKey && history.length > 0) {
      e.preventDefault();
      const newIndex = historyIndex < 0
        ? history.length - 1
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setValue(history[newIndex]);
      return;
    }

    // Ctrl+Down = forward in history
    if (e.key === 'ArrowDown' && e.ctrlKey && historyIndex >= 0) {
      e.preventDefault();
      if (historyIndex >= history.length - 1) {
        setHistoryIndex(-1);
        setValue('');
      } else {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
      }
      return;
    }

    // Escape = cancel if streaming
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      onCancel();
    }
  }, [handleSend, history, historyIndex, isStreaming, onCancel]);

  const canSend = value.trim().length > 0 && !isProcessing && !disabled;

  return (
    <div className="c3-chat-input-area">
      <div className="c3-chat-input-wrapper">
        <textarea
          ref={textareaRef}
          className="c3-chat-textarea"
          value={value}
          onChange={e => {
            setValue(e.target.value.slice(0, CHAT.MAX_INPUT_LENGTH));
            setHistoryIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            isProcessing
              ? 'Agent zpracovává...'
              : 'Napiš zprávu... (Enter = odeslat, Shift+Enter = nový řádek)'
          }
          disabled={disabled || (isProcessing && !isStreaming)}
          rows={1}
        />

        {isStreaming ? (
          <button
            className="c3-chat-cancel-btn"
            onClick={onCancel}
            title="Zrušit (Esc)"
          >
            ■ Stop
          </button>
        ) : (
          <button
            className="c3-chat-send-btn"
            onClick={handleSend}
            disabled={!canSend}
            title="Odeslat (Enter)"
          >
            ▶
          </button>
        )}
      </div>
    </div>
  );
};
