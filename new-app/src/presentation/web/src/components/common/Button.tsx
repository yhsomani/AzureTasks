import React, { forwardRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'secondary', size = 'md', isLoading = false, className = '', disabled, ...props }, ref) => {
    const baseClasses =
      'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 select-none';

    // Ensure WCAG 2.1 AA touch target >= 44x44px
    const sizeClasses = {
      sm: 'min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs',
      md: 'min-h-[44px] min-w-[44px] px-4 py-2 text-sm',
      lg: 'min-h-[48px] min-w-[48px] px-6 py-2.5 text-base',
    }[size];

    const variantClasses = {
      primary: 'primary bg-accent text-on-accent hover:opacity-90 font-semibold shadow-sm',
      secondary: 'secondary bg-surface border border-border text-text hover:border-border-strong',
      danger: 'danger bg-danger text-on-danger hover:opacity-90 font-semibold',
      ghost: 'ghost bg-transparent text-text hover:bg-surface border border-transparent',
    }[variant];

    const disabledClasses = disabled || isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`btn ${baseClasses} ${sizeClasses} ${variantClasses} ${disabledClasses} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="inline-flex items-center gap-2">
            <span className="spinner h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <span>Loading…</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
