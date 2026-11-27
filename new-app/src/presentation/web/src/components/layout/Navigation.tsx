import React from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CircleAlert,
  ClipboardList,
  GitBranch,
  Home,
  ListTodo,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceId, SubViewId } from '../../types/index.js';

export interface NavigationProps {
  currentWorkspace: WorkspaceId;
  currentSubView: SubViewId;
  onNavigate: (workspace: WorkspaceId, subView?: SubViewId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Navigation({
  currentWorkspace: _currentWorkspace,
  currentSubView,
  onNavigate,
  mobileOpen,
  onCloseMobile,
}: NavigationProps) {
  const workspaces: Array<{
    id: WorkspaceId;
    defaultSubView: SubViewId;
    label: string;
    subViews: Array<{ id: SubViewId; label: string; icon: LucideIcon }>;
  }> = [
    {
      id: 'daily',
      defaultSubView: 'mywork',
      label: 'Work',
      subViews: [
        { id: 'mywork', label: 'My work', icon: Home },
        { id: 'dashboard', label: "Today's delivery", icon: ClipboardList },
      ],
    },
    {
      id: 'planning',
      defaultSubView: 'planner',
      label: 'Team',
      subViews: [
        { id: 'planner', label: 'Plan & review', icon: CalendarDays },
        { id: 'explorer', label: 'Workload', icon: BarChart3 },
        { id: 'people', label: 'People', icon: Users },
        { id: 'calendar', label: 'Team calendar', icon: CalendarDays },
      ],
    },
    {
      id: 'intelligence',
      defaultSubView: 'azure-overview',
      label: 'Delivery',
      subViews: [
        { id: 'azure-overview', label: 'Projects & health', icon: BarChart3 },
        { id: 'azure-builds', label: 'Builds & pipelines', icon: Workflow },
        { id: 'azure-teams', label: 'Connected teams', icon: Users },
        { id: 'unassigned', label: 'Unassigned work', icon: CircleAlert },
      ],
    },
    {
      id: 'governance',
      defaultSubView: 'journal',
      label: 'Manage',
      subViews: [
        { id: 'journal', label: 'Audit trail', icon: ShieldCheck },
        { id: 'scheduler', label: 'Automation', icon: Workflow },
        { id: 'logs', label: 'System activity', icon: Activity },
        { id: 'settings', label: 'Access & settings', icon: Settings },
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
            <div className="brand-mark w-8 h-8 rounded bg-surface-card border border-border flex items-center justify-center font-bold text-accent" aria-hidden="true">
              <ListTodo size={18} strokeWidth={2.2} />
            </div>
            <div>
              <strong className="block text-sm text-text font-bold">3in1 Work</strong>
              <span className="text-xs text-text-muted">Plan. Focus. Deliver.</span>
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
                        onNavigate(sub.id === 'logs' ? 'daily' : ws.id, sub.id);
                        onCloseMobile();
                      }}
                      className={`nav-item w-full flex items-center gap-3 px-3 py-2 text-sm rounded font-medium transition-colors text-left min-h-[44px] ${
                        isSelected
                          ? 'active bg-accent/15 text-accent font-semibold'
                          : 'text-text hover:bg-surface-card hover:text-text'
                      }`}
                    >
                      <span className="nav-icon" aria-hidden="true">
                        <sub.icon size={16} strokeWidth={1.8} />
                      </span>
                      <span>{sub.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border text-xs text-text-muted">
          <span className="integration-note">
            <GitBranch size={13} aria-hidden="true" />
            Azure DevOps integration
          </span>
        </div>
      </aside>
    </>
  );
}
