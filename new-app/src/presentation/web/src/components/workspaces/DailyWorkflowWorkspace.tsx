import React, { useState } from 'react';
import { useDailyWorkflow } from '../../hooks/useDailyWorkflow.js';
import { useLogStream } from '../../hooks/useLogStream.js';
import { Card } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Badge } from '../common/Badge.js';
import { Modal } from '../common/Modal.js';
import { Skeleton } from '../common/Skeleton.js';
import type { SubViewId } from '../../types/index.js';

export function DailyWorkflowWorkspace({
  subView,
  isViewer,
  onNotify,
}: {
  subView: SubViewId;
  isViewer: boolean;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const {
    members,
    selectedPersonKey,
    setSelectedPersonKey,
    myTasks,
    prSummaries,
    isLoading,
    error,
    eodPreview,
    activateDailyTasks,
    previewEodClosure,
    executeEodClosure,
    createAdHocTask,
  } = useDailyWorkflow();

  const { logs, isConnected, isPaused, setIsPaused, clearLogs } = useLogStream();

  // Modals state
  const [adHocModalOpen, setAdHocModalOpen] = useState(false);
  const [adHocTitle, setAdHocTitle] = useState('');
  const [adHocDate, setAdHocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [adHocHours, setAdHocHours] = useState(8);

  const [eodModalOpen, setEodModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const handleActivate = async () => {
    if (isViewer) {
      onNotify('Read-only viewer credentials cannot change tasks', 'error');
      return;
    }
    setIsActivating(true);
    try {
      await activateDailyTasks();
      onNotify('Morning task activation completed successfully!', 'success');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Activation failed', 'error');
    } finally {
      setIsActivating(false);
    }
  };

  const handleOpenEod = async () => {
    setEodModalOpen(true);
    try {
      await previewEodClosure();
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'EOD Preview failed', 'error');
    }
  };

  const handleExecuteEod = async () => {
    if (isViewer) {
      onNotify('Read-only viewer credentials cannot change tasks', 'error');
      return;
    }
    setIsClosing(true);
    try {
      await executeEodClosure();
      onNotify('End-of-day closure executed successfully!', 'success');
      setEodModalOpen(false);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'EOD Execution failed', 'error');
    } finally {
      setIsClosing(false);
    }
  };

  const handleCreateAdHoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adHocTitle.trim()) {
      onNotify('Please enter a task title', 'error');
      return;
    }
    try {
      await createAdHocTask({
        personKey: selectedPersonKey || members[0]?.key,
        targetIsoDate: adHocDate,
        customTitle: adHocTitle.trim(),
        originalEstimate: adHocHours,
      });
      onNotify('Ad-hoc task created successfully!', 'success');
      setAdHocModalOpen(false);
      setAdHocTitle('');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Failed to create ad-hoc task', 'error');
    }
  };

  const selectedMember = members.find((m) => m.key === selectedPersonKey);
  const selectedMemberPrs = prSummaries.find((p) => p.personKey === selectedPersonKey);

  return (
    <div className="daily-workflow-workspace space-y-6">
      {/* 1-Click Operational Action Bar */}
      <Card
        title="1-Click Action Bar"
        subtitle="Operational controls for daily task lifecycle"
        className="border-accent/40 bg-surface-card"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={handleActivate}
              isLoading={isActivating}
              disabled={isViewer}
              className="font-semibold"
            >
              ☀️ Morning Activation
            </Button>
            <Button
              variant="secondary"
              id="eodRunNowBtn"
              onClick={handleOpenEod}
              className="font-semibold"
            >
              🌙 EOD Closure Review
            </Button>
            <Button
              variant="primary"
              onClick={() => setAdHocModalOpen(true)}
              disabled={isViewer}
            >
              + Ad-Hoc Task
            </Button>
          </div>
        }
      >
        <p className="text-xs text-text-muted">
          Activate morning tasks for the day, review deliverable PR evidence before EOD task closure, or schedule ad-hoc work items.
        </p>
      </Card>

      {/* Main Grid: Personal Cockpit & Today's Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1 & 2: Personal Cockpit (My Work) */}
        <div className="lg:col-span-2 space-y-6">
          <Card
            title="Personal Cockpit (My Work)"
            subtitle="Current active work items, estimates, and daily tasks"
            actions={
              <select
                aria-label="Select team member"
                value={selectedPersonKey}
                onChange={(e) => setSelectedPersonKey(e.target.value)}
                className="bg-surface-base border border-border text-text rounded px-3 py-1.5 text-sm min-h-[44px]"
              >
                {members.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            }
          >
            {isLoading ? (
              <Skeleton count={4} />
            ) : error ? (
              <p className="text-sm text-danger p-4">{error}</p>
            ) : myTasks.length === 0 ? (
              <div className="text-center py-8 text-text-muted">
                <p className="text-sm font-medium">No tasks recorded for this member today.</p>
                <p className="text-xs mt-1">Use "+ Ad-Hoc Task" to assign work or run Morning Activation.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myTasks.map((task) => (
                  <div
                    key={task.id}
                    className="task-card flex items-center justify-between p-3.5 bg-surface-base border border-border rounded-lg hover:border-border-strong transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-text-muted">#{task.id}</span>
                        <h4 className="font-semibold text-sm text-text task-title">{task.title}</h4>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span>Assigned: {task.assignedTo || selectedMember?.name}</span>
                        {task.targetDate && <span>Date: {task.targetDate}</span>}
                        {task.remainingWork !== undefined && (
                          <span>Remaining: {task.remainingWork}h</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <Badge
                        variant={
                          task.state === 'Closed'
                            ? 'success'
                            : task.state === 'Active'
                            ? 'info'
                            : 'neutral'
                        }
                      >
                        {task.state}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Today's Summary & PR Deliverable Sync */}
          <Card
            title="Today's Deliverable PR Sync"
            subtitle="Verified GitHub pull requests and commit deliverables"
          >
            {selectedMemberPrs?.pullRequests && selectedMemberPrs.pullRequests.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-text-muted mb-2">
                  <span>
                    Total: {selectedMemberPrs.totalCount} (Open: {selectedMemberPrs.openCount}, Merged: {selectedMemberPrs.mergedCount})
                  </span>
                  <span>Deliverables verified for auto-closure</span>
                </div>
                <div className="divide-y divide-border">
                  {selectedMemberPrs.pullRequests.map((pr) => (
                    <div key={pr.id} className="py-2.5 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <a
                          href={pr.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-accent hover:underline flex items-center gap-1.5"
                        >
                          <span>#{pr.number}</span>
                          <span>{pr.title}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                        <p className="text-xs text-text-muted">Repo: {pr.repository}</p>
                      </div>
                      <Badge variant={pr.state === 'merged' ? 'success' : 'info'}>
                        {pr.state}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-text-muted text-xs">
                No deliverable pull requests recorded for {selectedMember?.name || 'this member'} today.
              </div>
            )}
          </Card>
        </div>

        {/* Column 3: Live SSE Log Stream */}
        <div className="lg:col-span-1 space-y-6">
          <Card
            title="Live SSE Activity Stream"
            subtitle="Real-time log stream from /api/logs/stream"
            actions={
              <div className="flex items-center gap-2">
                <Badge variant={isConnected ? 'success' : 'warning'}>
                  {isConnected ? 'LIVE' : 'RECONNECTING'}
                </Badge>
                <button
                  type="button"
                  onClick={() => setIsPaused(!isPaused)}
                  className="text-xs px-3 py-1.5 rounded bg-surface border border-border text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={clearLogs}
                  className="text-xs px-3 py-1.5 rounded bg-surface border border-border text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  Clear
                </button>
              </div>
            }
          >
            <div
              className="log-terminal font-mono text-xs bg-black/80 text-emerald-400 p-3 rounded-lg h-96 overflow-y-auto space-y-1.5 border border-border"
              role="log"
              aria-live="polite"
              aria-label="Application server log terminal"
            >
              {logs.length === 0 ? (
                <p className="text-neutral-500 italic">Waiting for events from server…</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="leading-tight flex items-start gap-2">
                    <span className="text-neutral-500 select-none text-[10px]">
                      {log.timestamp.slice(11, 19)}
                    </span>
                    <span
                      className={
                        log.level === 'error'
                          ? 'text-rose-400'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : 'text-emerald-300'
                      }
                    >
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-neutral-200">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Ad-Hoc Task Modal */}
      <Modal
        isOpen={adHocModalOpen}
        onClose={() => setAdHocModalOpen(false)}
        title="Create Ad-Hoc Work Item"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdHocModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateAdHoc}>
              Create Work Item
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateAdHoc} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text mb-1" htmlFor="adhoc-member">
              Assignee
            </label>
            <select
              id="adhoc-member"
              value={selectedPersonKey}
              onChange={(e) => setSelectedPersonKey(e.target.value)}
              className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
            >
              {members.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text mb-1" htmlFor="adhoc-title">
              Task Title
            </label>
            <input
              id="adhoc-title"
              type="text"
              required
              value={adHocTitle}
              onChange={(e) => setAdHocTitle(e.target.value)}
              placeholder="e.g. Incident triage, hotfix deployment"
              className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text mb-1" htmlFor="adhoc-date">
                Target Date
              </label>
              <input
                id="adhoc-date"
                type="date"
                value={adHocDate}
                onChange={(e) => setAdHocDate(e.target.value)}
                className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1" htmlFor="adhoc-hours">
                Estimate Hours
              </label>
              <input
                id="adhoc-hours"
                type="number"
                min="1"
                max="24"
                value={adHocHours}
                onChange={(e) => setAdHocHours(Number(e.target.value))}
                className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* EOD Closure Review Modal */}
      <Modal
        isOpen={eodModalOpen}
        onClose={() => setEodModalOpen(false)}
        title="End-of-Day Task Closure Review"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEodModalOpen(false)}>
              Cancel
            </Button>
            {eodPreview.ready && (
              <Button
                variant="danger"
                id="executeBtn"
                onClick={handleExecuteEod}
                isLoading={isClosing}
                disabled={isViewer}
              >
                Execute EOD Closure
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            End-of-day closure closes active tasks and sets remaining work to zero based on deliverable verification.
          </p>

          <div className="p-3 bg-surface-base border border-border rounded text-xs space-y-1">
            <span className="font-semibold block text-text">Deliverable Gating Policy:</span>
            <span className="text-text-muted">
              Team members must have at least one verified pull request or commit deliverable today for automatic closure.
            </span>
          </div>

          {eodPreview.ready ? (
            <div className="p-3 bg-emerald-950/20 border border-emerald-800 rounded text-xs text-emerald-300">
              ✓ Dry run completed successfully. You may now execute end-of-day closure.
            </div>
          ) : (
            <div className="p-3 bg-surface-card border border-border rounded text-xs text-text-muted">
              Computing dry run preview…
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
