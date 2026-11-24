import React from 'react';
import type { WorkspaceId, SubViewId } from '../../types/index.js';

export interface NavigationProps {
  currentWorkspace: WorkspaceId;
  currentSubView: SubViewId;
  onNavigate: (workspace: WorkspaceId, subView?: SubViewId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Navigation({
  currentWorkspace,
  currentSubView,
  onNavigate,
  mobileOpen,
  onCloseMobile,
}: NavigationProps) {
  const workspaces: Array<{
    id: WorkspaceId;
    defaultSubView: SubViewId;
    label: string;
    icon: string;
    subViews: Array<{ id: SubViewId; label: string }>;
  }> = [
    {
      id: 'daily',
      defaultSubView: 'mywork',
      label: 'Daily Workflow',
      icon: '⚡',
      subViews: [
        { id: 'mywork', label: 'Personal Cockpit' },
        { id: 'dashboard', label: "Today's Summary" },
        { id: 'logs', label: 'Live SSE Stream' },
      ],
    },
    {
      id: 'planning',
      defaultSubView: 'planner',
      label: 'Team & Planning',
      icon: '📅',
      subViews: [
        { id: 'planner', label: 'Plan & Review' },
        { id: 'explorer', label: 'Coverage Matrix' },
        { id: 'people', label: 'Team Roster' },
        { id: 'calendar', label: 'Work Calendar' },
      ],
    },
    {
      id: 'governance',
      defaultSubView: 'journal',
      label: 'Governance & Ops',
      icon: '🛡️',
      subViews: [
        { id: 'journal', label: 'Audit Log' },
        { id: 'scheduler', label: 'Scheduler Daemon' },
        { id: 'settings', label: 'RBAC & Identity' },
      ],
    },
    {
      id: 'intelligence',
      defaultSubView: 'azure-overview',
      label: 'Azure Intelligence',
      icon: '📊',
      subViews: [
        { id: 'azure-overview', label: 'ALM & KPIs Overview' },
        { id: 'azure-builds', label: 'Build Health' },
        { id: 'azure-teams', label: 'Enterprise Teams' },
        { id: 'unassigned', label: 'Unassigned Tasks' },
      ],
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          id="navBackdrop"
          className="nav-backdrop open fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        id="sidebar"
        className={`sidebar ${mobileOpen ? 'open' : ''} fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-border transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static md:w-60 flex flex-col ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="brand flex items-center gap-3">
            <div className="brand-mark w-8 h-8 rounded bg-surface-card border border-border flex items-center justify-center font-bold text-accent">
              3in1
            </div>
            <div>
              <strong className="block text-sm text-text font-bold">Task Studio</strong>
              <span className="text-xs text-text-muted">Work Operations</span>
            </div>
          </div>
          <button
            type="button"
            className="md:hidden p-2 text-text-muted hover:text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            ✕
          </button>
        </div>

        <nav className="nav flex-1 px-3 py-4 space-y-6 overflow-y-auto" aria-label="Primary navigation">
          {workspaces.map((ws) => (
            <div key={ws.id} className="nav-group">
              <span className="nav-group-label px-3 text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
                {ws.label}
              </span>

              <div className="space-y-1">
                {ws.subViews.map((sub) => {
                  const isSelected = currentSubView === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      id={`view-${sub.id}`}
                      data-view={sub.id}
                      aria-current={isSelected ? 'page' : undefined}
                      onClick={() => {
                        onNavigate(ws.id, sub.id);
                        onCloseMobile();
                      }}
                      className={`nav-item w-full flex items-center gap-3 px-3 py-2 text-sm rounded font-medium transition-colors text-left min-h-[44px] ${
                        isSelected
                          ? 'active bg-accent/15 text-accent font-semibold'
                          : 'text-text hover:bg-surface-card hover:text-text'
                      }`}
                    >
                      <span aria-hidden="true">{ws.icon}</span>
                      <span>{sub.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border text-xs text-text-muted">
          <span>Enterprise WorkOps Platform</span>
        </div>
      </aside>
    </>
  );
}
