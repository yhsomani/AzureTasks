import React from 'react';
import { Button } from '../common/Button.js';
import type { UserSession } from '../../types/index.js';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  session: UserSession;
  theme: string;
  onToggleTheme: () => void;
  onQuickRun: () => void;
  onOpenMobileNav: () => void;
  mobileNavOpen: boolean;
}

export function Header({
  title,
  subtitle,
  session,
  theme,
  onToggleTheme,
  onQuickRun,
  onOpenMobileNav,
  mobileNavOpen,
}: HeaderProps) {
  return (
    <header className="topbar flex items-center justify-between pb-4 mb-6 border-b border-border gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-controls="sidebar"
          aria-expanded={mobileNavOpen}
          aria-label="Open primary navigation"
          className="md:hidden p-2 text-text border border-border rounded min-w-[44px] min-h-[44px] flex items-center justify-center bg-surface hover:bg-surface-card"
        >
          ☰
        </button>

        <div className="page-identity">
          <h1 className="text-xl md:text-2xl font-bold text-text leading-tight" style={{ fontSize: 'var(--font-h1)' }}>
            {title}
          </h1>
          {subtitle && <p className="subtitle text-xs md:text-sm text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="topbar-actions flex items-center gap-3">
        {/* Quick Run button links safely to Planning/Reviewing */}
        <Button
          id="quickRunBtn"
          variant="primary"
          onClick={onQuickRun}
          className="font-semibold"
        >
          Review plan
        </Button>

        {/* Theme Toggle */}
        <Button
          type="button"
          variant="secondary"
          onClick={onToggleTheme}
          aria-label={`Toggle theme (currently ${theme})`}
          className="min-w-[44px] min-h-[44px]"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </Button>

        {/* User Identity / Role Pill */}
        <div
          id="viewerModeNotice"
          className="user-pill flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-xs text-text min-h-[44px]"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <span className="font-medium">{session.user}</span>
          <span className="text-text-muted text-[11px] uppercase tracking-wider">
            ({session.role})
          </span>
          {session.viewerMode && (
            <span className="text-amber-400 font-bold ml-1" title="Read-only viewer credentials cannot change tasks">
              [VIEWER]
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
