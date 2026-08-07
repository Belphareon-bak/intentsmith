import * as React from 'react';
import { cn } from '../../../../../lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'glass';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-c3-bg3 border-c3-border2',
      glass: 'glass border-c3-border2/50',
    };

    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border px-3 py-2 text-sm',
          'text-c3-tx1 placeholder:text-c3-tx4',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-c3-accent focus-visible:ring-offset-0',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-all duration-200',
          variants[variant],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
