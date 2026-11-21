import React from 'react';

export interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  children: React.ReactNode;
  icon?: string;
  className?: string;
}

export function Badge({ variant = 'neutral', children, icon, className = '' }: BadgeProps) {
  const variantStyles = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    danger: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    info: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
    neutral: 'bg-surface-card text-text-muted border-border',
  }[variant];

  const defaultIcon = {
    success: '✓',
    warning: '⚠',
    danger: '✕',
    info: 'ℹ',
    neutral: '•',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${variantStyles} ${className}`}
    >
      <span aria-hidden="true" className="text-xs">
        {icon || defaultIcon}
      </span>
      <span>{children}</span>
    </span>
  );
}
