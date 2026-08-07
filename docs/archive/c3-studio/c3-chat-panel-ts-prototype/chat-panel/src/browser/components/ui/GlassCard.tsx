import * as React from 'react';
import { cn } from '../../../../../lib/utils/cn';

/**
 * Aceternity-style glassmorphism card with hover effects
 */
export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  shine?: boolean;
  glow?: boolean;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, hover = true, shine = false, glow = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'relative rounded-xl p-6',
          'glass-card',
          hover && 'group cursor-pointer',
          shine && 'card-shine',
          glow && 'glow-hover',
          className
        )}
        {...props}
      >
        {/* Gradient overlay on hover */}
        {hover && (
          <div
            className={cn(
              'absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300',
              'bg-gradient-to-br from-c3-accent/10 to-transparent',
              'group-hover:opacity-100'
            )}
          />
        )}

        {/* Content */}
        <div className="relative z-10">{children}</div>

        {/* Bottom gradient line */}
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 h-[1px]',
            'bg-gradient-to-r from-transparent via-c3-accent/50 to-transparent',
            'opacity-0 transition-opacity duration-300',
            hover && 'group-hover:opacity-100'
          )}
        />
      </div>
    );
  }
);
GlassCard.displayName = 'GlassCard';

export { GlassCard };
