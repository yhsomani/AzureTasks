import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Card({ title, subtitle, actions, children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`card bg-surface border border-border rounded-lg p-5 transition-shadow ${className}`}
      {...props}
    >
      {(title || actions) && (
        <div className="card-head flex items-center justify-between pb-3 mb-4 border-b border-border">
          <div>
            {title && <h3 className="font-semibold text-base text-text">{title}</h3>}
            {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
