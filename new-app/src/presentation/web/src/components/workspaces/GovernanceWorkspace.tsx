import React, { useState } from 'react';
import { useGovernance } from '../../hooks/useGovernance.js';
import { Card } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Badge } from '../common/Badge.js';
import { Modal } from '../common/Modal.js';
import { Skeleton } from '../common/Skeleton.js';
import type { SubViewId, UserSession, JournalEntry } from '../../types/index.js';

export function GovernanceWorkspace({
  subView,
  session,
  isViewer,
  onNotify,
}: {
  subView: SubViewId;
  session: UserSession;
  isViewer: boolean;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const {
    journalEntries,
    schedulerRunning,
    health,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    selectedAction,
    setSelectedAction,
    toggleScheduler,
    triggerSchedulerRun,
  } = useGovernance();

  // Selected Journal Entry for Detail Modal
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  const handleToggleScheduler = async () => {
    if (isViewer) {
      onNotify('Read-only viewer credentials cannot modify scheduler settings', 'error');
      return;
    }
    try {
      await toggleScheduler(!schedulerRunning);
      onNotify(`Scheduler ${!schedulerRunning ? 'enabled' : 'disabled'} successfully`, 'success');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Scheduler toggle failed', 'error');
    }
  };

  const handleRunNow = async () => {
    if (isViewer) {
      onNotify('Read-only viewer credentials cannot trigger executions', 'error');
      return;
    }
    setIsTriggering(true);
    try {
      await triggerSchedulerRun();
      onNotify('Scheduled execution triggered successfully!', 'success');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Trigger failed', 'error');
    } finally {
      setIsTriggering(false);
    }
  };

  const isSettingsOnly = subView === 'settings';
  const showAll = !subView;

  const showHealthAndSettings = showAll || isSettingsOnly;
  const showScheduler = showAll || subView === 'scheduler' || subView === 'journal';
  const showJournal = showAll || subView === 'journal';

  return (
    <div className="governance-workspace space-y-6">
      {/* Top Grid: System Health Telemetry & RBAC Identity */}
      {showHealthAndSettings && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* System Health Telemetry */}
          <Card
            title="System Health Telemetry"
            subtitle="Real-time operational metrics and infrastructure status"
            className="lg:col-span-2"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="kpi p-3 bg-surface-base border border-border rounded-lg space-y-1">
                <span className="kpi-label text-[11px] text-text-muted font-medium uppercase tracking-wider block">
                  Overall Status
                </span>
                <div className="kpi-value text-base font-bold text-text">
                  <Badge variant={health?.status === 'unhealthy' ? 'danger' : 'success'}>
                    {health?.status ? health.status.toUpperCase() : 'OPERATIONAL'}
                  </Badge>
                </div>
              </div>

              <div className="kpi p-3 bg-surface-base border border-border rounded-lg space-y-1">
                <span className="kpi-label text-[11px] text-text-muted font-medium uppercase tracking-wider block">
                  Process Uptime
                </span>
                <div className="kpi-value text-base font-bold text-text">
                  {health?.uptime ? `${Math.floor(health.uptime / 60)}m` : 'Active'}
                </div>
              </div>

              <div className="kpi p-3 bg-surface-base border border-border rounded-lg space-y-1">
                <span className="kpi-label text-[11px] text-text-muted font-medium uppercase tracking-wider block">
                  Azure Connectivity
                </span>
                <div className="kpi-value text-base font-bold text-text">
                  <Badge variant="success">CONNECTED</Badge>
                </div>
              </div>

              <div className="kpi p-3 bg-surface-base border border-border rounded-lg space-y-1">
                <span className="kpi-label text-[11px] text-text-muted font-medium uppercase tracking-wider block">
                  GitHub API
                </span>
                <div className="kpi-value text-base font-bold text-text">
                  <Badge variant="success">READY</Badge>
                </div>
              </div>
            </div>
          </Card>

          {/* RBAC Identity & Session View */}
          <Card title="RBAC & Operator Identity" subtitle="Active security context and roles">
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 bg-surface-base border border-border rounded">
                <span className="text-text-muted">Authenticated User</span>
                <span className="font-semibold text-text">{session.user}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-surface-base border border-border rounded">
                <span className="text-text-muted">Assigned Role</span>
                <span className="font-semibold text-accent uppercase tracking-wider">
                  {session.role}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-surface-base border border-border rounded">
                <span className="text-text-muted">Mutation Allowed</span>
                <span className="font-semibold text-text">
                  {session.viewerMode ? 'No (Read-Only)' : 'Yes (Full Audit)'}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Scheduler Daemon Controls */}
      {showScheduler && (
        <Card
          title="Scheduler Daemon Controls"
          subtitle="Automated background task planning, morning activation, and EOD closure"
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant={schedulerRunning ? 'danger' : 'primary'}
                size="sm"
                onClick={handleToggleScheduler}
                disabled={isViewer}
              >
                {schedulerRunning ? 'Disable Scheduler' : 'Enable Scheduler'}
              </Button>
              <Button
                variant="secondary"
                id="schedRunNowBtn"
                size="sm"
                onClick={handleRunNow}
                isLoading={isTriggering}
                disabled={isViewer}
              >
                Run Now
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-surface-base border border-border rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden="true">
                  ⚙️
                </span>
                <div>
                  <h4 className="font-semibold text-sm text-text">Background Daemon</h4>
                  <p className="text-xs text-text-muted">
                    Runs daily morning planning (09:30), task activation (17:30), and EOD closure (18:15).
                  </p>
                </div>
              </div>
              <Badge variant={schedulerRunning ? 'success' : 'neutral'}>
                {schedulerRunning ? 'DAEMON RUNNING' : 'STOPPED'}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {/* Audit Log Explorer & Recovery */}
      {showJournal && (
        <Card
          title="Audit Log Explorer & Attribution"
          subtitle="Immutable journal records with user attribution and operation history"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Search audit entries…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-surface-base border border-border text-text rounded px-3 py-1.5 text-xs min-h-[44px] min-w-[200px]"
            />
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              aria-label="Filter by action"
              className="bg-surface-base border border-border text-text rounded px-3 py-1.5 text-xs min-h-[44px]"
            >
              <option value="ALL">All Actions</option>
              <option value="TASK_CREATION">Task Creation</option>
              <option value="TASK_CLOSURE">Task Closure</option>
              <option value="TASK_ACTIVATION">Task Activation</option>
              <option value="PLAN_GENERATION">Plan Generation</option>
              <option value="REPAIR_RELATIONS">Repair Relations</option>
            </select>
          </div>
        }
      >
        {isLoading ? (
          <Skeleton count={5} />
        ) : error ? (
          <p className="text-sm text-danger p-4">{error}</p>
        ) : journalEntries.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">
            No audit log entries matching current criteria.
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden">
            {journalEntries.map((entry) => (
              <div
                key={entry.id}
                onClick={() => setSelectedEntry(entry)}
                className="p-3.5 hover:bg-surface-base cursor-pointer transition-colors flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-text">{entry.action}</span>
                    <Badge variant={entry.status === 'SUCCESS' ? 'success' : 'danger'}>
                      {entry.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span>Operator: {entry.operator || 'system'}</span>
                    <span>Time: {new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <Button variant="ghost" size="sm" onClick={() => setSelectedEntry(entry)}>
                  Inspect
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      )}

      {/* Entry Detail Modal */}
      <Modal
        isOpen={!!selectedEntry}
        onClose={() => setSelectedEntry(null)}
        title="Audit Log Entry Details"
        footer={
          <Button variant="secondary" onClick={() => setSelectedEntry(null)}>
            Close
          </Button>
        }
      >
        {selectedEntry && (
          <div className="space-y-3 text-xs">
            <div>
              <span className="font-semibold text-text block">Action:</span>
              <span className="font-mono text-accent">{selectedEntry.action}</span>
            </div>
            <div>
              <span className="font-semibold text-text block">Attribution (Operator):</span>
              <span className="text-text">{selectedEntry.operator}</span>
            </div>
            <div>
              <span className="font-semibold text-text block">Timestamp:</span>
              <span className="text-text-muted">{selectedEntry.timestamp}</span>
            </div>
            <div>
              <span className="font-semibold text-text block mb-1">Payload:</span>
              <pre className="p-3 bg-black/60 text-emerald-300 rounded font-mono overflow-x-auto text-[11px] max-h-60 border border-border">
                {JSON.stringify(selectedEntry.details || {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
