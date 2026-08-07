import * as React from 'react';
import { GlassCard, Badge } from '../../../../c3-chat-panel/src/browser/components/ui';

/**
 * Expertise card with Pro mode design (glassmorphism)
 */
interface ExpertiseCardProProps {
  expertise: {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    tags?: string[];
    lastUsed?: Date;
  };
  onClick?: () => void;
}

export function ExpertiseCardPro({ expertise, onClick }: ExpertiseCardProProps) {
  return (
    <GlassCard
      hover
      shine
      glow
      onClick={onClick}
      className="min-w-[280px] max-w-[320px]"
    >
      {/* Header with emoji */}
      <div className="flex items-start gap-3 mb-3">
        {expertise.emoji && (
          <div className="text-3xl flex-shrink-0 animate-pulse">{expertise.emoji}</div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-c3-tx1 mb-1 truncate">
            {expertise.name}
          </h3>
          {expertise.description && (
            <p className="text-sm text-c3-tx3 line-clamp-2">{expertise.description}</p>
          )}
        </div>
      </div>

      {/* Tags */}
      {expertise.tags && expertise.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {expertise.tags.slice(0, 3).map((tag, idx) => (
            <Badge key={idx} variant="glass" className="text-xs">
              {tag}
            </Badge>
          ))}
          {expertise.tags.length > 3 && (
            <Badge variant="secondary" className="text-xs">
              +{expertise.tags.length - 3}
            </Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-c3-tx4 mt-4 pt-3 border-t border-c3-border">
        <span>Expertyza</span>
        {expertise.lastUsed && (
          <span>
            {new Date(expertise.lastUsed).toLocaleDateString('cs-CZ', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </div>

      {/* Gradient accent line (shows on hover) */}
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-c3-accent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </GlassCard>
  );
}
