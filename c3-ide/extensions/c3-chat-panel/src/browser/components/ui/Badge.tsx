import * as React from 'react';
import { cn } from '../../../../../lib/utils/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'glass';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-c3-accent text-white',
    secondary: 'bg-c3-bg3 text-c3-tx2',
    outline: 'border border-c3-border2 text-c3-tx2',
    success: 'bg-green-500/20 text-green-400 border border-green-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    glass: 'glass text-c3-tx1',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
