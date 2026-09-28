import * as React from 'react';
import { GlassCard, Badge } from '../../../../c3-chat-panel/src/browser/components/ui';

/**
 * Conversation card with Pro mode design (glassmorphism)
 */
interface ConversationCardProProps {
  conversation: {
    id: string;
    title: string;
    preview?: string;
    expertise?: string;
    messageCount?: number;
    timestamp?: Date;
    unread?: boolean;
  };
  onClick?: () => void;
}

export function ConversationCardPro({ conversation, onClick }: ConversationCardProProps) {
  return (
    <GlassCard
      hover
      shine
      onClick={onClick}
      className="min-w-[280px] max-w-[320px] relative"
    >
      {/* Unread indicator */}
      {conversation.unread && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-c3-accent animate-pulse" />
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full glass flex items-center justify-center text-lg flex-shrink-0">
          💬
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-c3-tx1 mb-1 line-clamp-1">
            {conversation.title}
          </h3>
          {conversation.expertise && (
            <Badge variant="glass" className="text-xs">
              {conversation.expertise}
            </Badge>
          )}
        </div>
      </div>

      {/* Preview */}
      {conversation.preview && (
        <p className="text-sm text-c3-tx3 line-clamp-2 mb-3">{conversation.preview}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-c3-tx4 mt-4 pt-3 border-t border-c3-border/50">
        <div className="flex items-center gap-2">
          {conversation.messageCount !== undefined && (
            <span>{conversation.messageCount} zpráv</span>
          )}
        </div>
        {conversation.timestamp && (
          <span>
            {new Date(conversation.timestamp).toLocaleDateString('cs-CZ', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </div>

      {/* Hover glow effect */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="absolute inset-0 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.3)]" />
      </div>
    </GlassCard>
  );
}
