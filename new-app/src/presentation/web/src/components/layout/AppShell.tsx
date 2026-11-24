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
      } else if (['planner', 'explorer', 'people', 'calendar'].includes(hash)) {
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

  const getWorkspaceTitle = () => {
    switch (currentWorkspace) {
      case 'daily':
        return 'Daily Workflow Cockpit';
      case 'planning':
        return 'Team & Sprint Planning';
      case 'governance':
        return 'Governance & Operations';
      case 'intelligence':
        return 'Azure DevOps ALM Intelligence';
      default:
        return 'Task Studio';
    }
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
          title={getWorkspaceTitle()}
          subtitle="Work Operations platform for planning, review, and automation"
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
