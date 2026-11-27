import React, { useState, useEffect } from 'react';
import { Header } from './Header.js';
import { Navigation } from './Navigation.js';
import { Toast, type ToastMessage } from '../common/Toast.js';
import { useSession } from '../../hooks/useSession.js';
import { useTheme } from '../../hooks/useTheme.js';
import { DailyWorkflowWorkspace } from '../workspaces/DailyWorkflowWorkspace.js';
import { TeamPlanningWorkspace } from '../workspaces/TeamPlanningWorkspace.js';
import { GovernanceWorkspace } from '../workspaces/GovernanceWorkspace.js';
import { AzureIntelligenceWorkspace } from '../workspaces/AzureIntelligenceWorkspace.js';
import type { WorkspaceId, SubViewId } from '../../types/index.js';

export function AppShell() {
  const { session, isViewer } = useSession();
  const { theme, toggleTheme } = useTheme();

  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceId>('daily');
  const [currentSubView, setCurrentSubView] = useState<SubViewId>('mywork');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (message: string, type: ToastMessage['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // URL hash navigation support
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      if (!hash) return;

      if (['mywork', 'dashboard', 'logs'].includes(hash)) {
        setCurrentWorkspace('daily');
        setCurrentSubView(hash as SubViewId);
      } else if (['planner', 'explorer', 'burndown', 'lifecycle', 'people', 'calendar'].includes(hash)) {
        setCurrentWorkspace('planning');
        setCurrentSubView(hash as SubViewId);
      } else if (['journal', 'scheduler', 'settings'].includes(hash)) {
        setCurrentWorkspace('governance');
        setCurrentSubView(hash as SubViewId);
      } else if (['azure-overview', 'azure-builds', 'azure-teams', 'unassigned', 'sprint-progress'].includes(hash)) {
        setCurrentWorkspace('intelligence');
        setCurrentSubView(hash as SubViewId);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const handleNavigate = (ws: WorkspaceId, subView?: SubViewId) => {
    setCurrentWorkspace(ws);
    const view =
      subView ||
      (ws === 'daily' ? 'mywork' : ws === 'planning' ? 'planner' : ws === 'governance' ? 'journal' : 'azure-overview');
    setCurrentSubView(view);
    window.location.hash = view;
  };

  const pageCopy: Record<SubViewId, { title: string; subtitle: string }> = {
    mywork: { title: 'My work', subtitle: 'A clear view of what needs your attention today.' },
    dashboard: { title: "Today's delivery", subtitle: 'Review team deliverables and work completed today.' },
    logs: { title: 'System activity', subtitle: 'Live operational events and application logs.' },
    planner: { title: 'Plan & review', subtitle: "Shape the team's workload before creating work items." },
    explorer: { title: 'Team workload', subtitle: 'Understand work distribution, capacity, and coverage.' },
    burndown: { title: 'Sprint burndown', subtitle: 'Track progress against the current iteration.' },
    lifecycle: { title: 'Work item lifecycle', subtitle: 'Review task state transitions and delivery flow.' },
    people: { title: 'People', subtitle: 'Manage team identities, roles, and capacity.' },
    calendar: { title: 'Team calendar', subtitle: 'Coordinate working days, holidays, and availability.' },
    journal: { title: 'Audit trail', subtitle: 'Review attributed actions and operational outcomes.' },
    scheduler: { title: 'Automation', subtitle: 'Manage scheduled jobs and recurring workflows.' },
    settings: { title: 'Access & settings', subtitle: 'Configure identity, permissions, and workspace behavior.' },
    'azure-overview': { title: 'Projects & health', subtitle: 'A cross-project view of delivery and engineering health.' },
    'azure-builds': { title: 'Builds & pipelines', subtitle: 'Find delivery risks and inspect recent pipeline runs.' },
    'azure-teams': { title: 'Connected teams', subtitle: 'Explore teams and project ownership from Azure DevOps.' },
    unassigned: { title: 'Unassigned work', subtitle: 'Find work items that need a clear owner.' },
    'sprint-progress': { title: 'Sprint progress', subtitle: 'See how work is moving through the current sprint.' },
  };

  return (
    <div className="app flex min-h-screen bg-bg text-text">
      {/* Skip to Content for WCAG keyboard accessibility */}
      <a
        href="#main"
        className="skip-link sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-on-accent focus:rounded focus:shadow-lg focus:outline-none"
      >
        Skip to content
      </a>

      {/* Navigation Sidebar */}
      <Navigation
        currentWorkspace={currentWorkspace}
        currentSubView={currentSubView}
        onNavigate={handleNavigate}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      {/* Main Content Area */}
      <main id="main" tabIndex={-1} className="main flex-1 p-4 md:p-8 overflow-y-auto focus:outline-none">
        <Header
          title={pageCopy[currentSubView].title}
          subtitle={pageCopy[currentSubView].subtitle}
          session={session}
          theme={theme}
          onToggleTheme={toggleTheme}
          onQuickRun={() => handleNavigate('planning', 'planner')}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          mobileNavOpen={mobileNavOpen}
        />

        {/* Workspace Views */}
        {currentWorkspace === 'daily' && (
          <DailyWorkflowWorkspace
            subView={currentSubView}
            isViewer={isViewer}
            currentUser={session.user}
            onNotify={addToast}
          />
        )}

        {currentWorkspace === 'planning' && (
          <TeamPlanningWorkspace
            subView={currentSubView}
            isViewer={isViewer}
            onNotify={addToast}
          />
        )}

        {currentWorkspace === 'governance' && (
          <GovernanceWorkspace
            subView={currentSubView}
            session={session}
            isViewer={isViewer}
            onNotify={addToast}
          />
        )}

        {currentWorkspace === 'intelligence' && (
          <AzureIntelligenceWorkspace
            subView={currentSubView}
            onNotify={addToast}
          />
        )}

        {/* Floating Toast Notification Container */}
        <Toast toasts={toasts} onDismiss={removeToast} />
      </main>
    </div>
  );
}
