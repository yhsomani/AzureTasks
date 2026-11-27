import React, { useState } from 'react';
import { GitBranch, Home, ListTodo } from 'lucide-react';
import { useDailyWorkflow } from '../../hooks/useDailyWorkflow.js';
import { useLogStream } from '../../hooks/useLogStream.js';
import { Card } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Badge } from '../common/Badge.js';
import { Modal } from '../common/Modal.js';
import { Skeleton } from '../common/Skeleton.js';
import type { SubViewId } from '../../types/index.js';

function getSafeWorkItemUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function DailyWorkflowWorkspace({
  subView,
  isViewer,
  currentUser,
  onNotify,
}: {
  subView: SubViewId;
  isViewer: boolean;
  currentUser: string;
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
  } = useDailyWorkflow(currentUser);

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
    if (!selectedPersonKey) {
      onNotify('Choose a team member before assigning a task', 'error');
      return;
    }
    if (!adHocTitle.trim()) {
      onNotify('Please enter a task title', 'error');
      return;
    }
    try {
      await createAdHocTask({
        personKey: selectedPersonKey,
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
  const activeTasks = myTasks.filter((task) => !['closed', 'done', 'resolved', 'removed'].includes(task.state.trim().toLowerCase()));
  const activeTaskCount = activeTasks.length;
  const remainingHours = activeTasks.reduce(
    (total, task) => total + (Number.isFinite(task.remainingWork) ? task.remainingWork || 0 : 0),
    0
  );
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  return (
    <div className="daily-workflow-workspace work-page space-y-6">
      {subView !== 'logs' && (
        <section className="work-intro">
          <div>
            <p className="section-kicker">{dateLabel}</p>
            <h2>{subView === 'dashboard' ? 'Make progress visible.' : 'Make room for focused work.'}</h2>
            <p>
              {subView === 'dashboard'
                ? 'Review what is moving across the team and the pull requests behind it.'
                : 'Your active work, delivery evidence, and the next useful action in one place.'}
            </p>
          </div>
          {subView === 'mywork' && (
            <Button
              variant="primary"
              onClick={() => setAdHocModalOpen(true)}
              disabled={isViewer || !selectedPersonKey}
              aria-label="Add task"
            >
              + Add task
            </Button>
          )}
        </section>
      )}

      {subView === 'mywork' && (
        <section className="team-operations" aria-labelledby="team-operations-title">
          <div className="team-operations-copy">
            <div>
              <p className="section-kicker">Team operations</p>
              <h2 id="team-operations-title">Daily lifecycle</h2>
            </div>
            <p>These controls affect the team, not just the person selected below.</p>
          </div>
          <div className="team-operations-actions">
            <Button
              variant="secondary"
              onClick={handleActivate}
              isLoading={isActivating}
              disabled={isViewer}
              aria-label="Morning Activation — all team members"
            >
              Activate today's plan
            </Button>
            <Button
              variant="secondary"
              id="eodRunNowBtn"
              onClick={handleOpenEod}
              aria-label="EOD Closure Review — all team members"
            >
              Review end of day
            </Button>
          </div>
        </section>
      )}

      {subView === 'logs' ? (
        <div className="w-full space-y-6">
          <Card
            title="System activity"
            subtitle="Live operational events and application logs"
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
                <p className="text-neutral-500 italic">Waiting for events from server...</p>
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
      ) : (
        <>
          <section className="work-summary-grid" aria-label="Work summary">
            <div className="work-summary-card">
              <span>Active work</span>
              <strong>{selectedPersonKey ? activeTaskCount : '--'}</strong>
              <small>{selectedMember?.name || 'Choose a person to view'}</small>
            </div>
            <div className="work-summary-card">
              <span>Remaining estimate</span>
              <strong>{selectedPersonKey ? `${remainingHours}h` : '--'}</strong>
              <small>Across active work items</small>
            </div>
            <div className="work-summary-card">
              <span>Pull requests</span>
              <strong>{selectedPersonKey ? selectedMemberPrs?.totalCount ?? 0 : '--'}</strong>
              <small>{selectedMemberPrs?.mergedCount ?? 0} merged</small>
            </div>
          </section>

          <div className="work-content-grid">
            <Card
              title="Assigned work items"
              subtitle={selectedMember ? `Viewing ${selectedMember.name}` : 'Choose a person to see their assigned work'}
              className="work-panel work-tasks-panel"
              actions={
                <select
                  aria-label="Select team member"
                  value={selectedPersonKey}
                  onChange={(e) => setSelectedPersonKey(e.target.value)}
                  className="bg-surface-base border border-border text-text rounded px-3 py-1.5 text-sm min-h-[44px]"
                >
                  <option value="" disabled>
                    Choose a team member
                  </option>
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
              ) : !selectedPersonKey ? (
                <div className="work-empty-state">
                  <Home size={22} aria-hidden="true" />
                  <p className="font-medium">Choose a team member to see their work.</p>
                  <span>Your view will not switch to another person's work automatically.</span>
                </div>
              ) : myTasks.length === 0 ? (
                <div className="work-empty-state">
                  <ListTodo size={22} aria-hidden="true" />
                  <p className="font-medium">No assigned work items found.</p>
                  <span>Add a task or review the team plan to get started.</span>
                </div>
              ) : (
                <div className="work-task-list">
                  {myTasks.map((task) => {
                    const workItemUrl = getSafeWorkItemUrl(task.url);
                    return (
                      <article key={task.id} className="work-task-row">
                        <div className="work-task-main">
                          <div className="work-task-title">
                            <span className="work-task-id">#{task.id}</span>
                            {workItemUrl ? (
                              <a href={workItemUrl} target="_blank" rel="noopener noreferrer">
                                {task.title}
                              </a>
                            ) : (
                              <h3>{task.title}</h3>
                            )}
                          </div>
                          <div className="work-task-meta">
                            <span>{task.assignedTo || selectedMember?.name}</span>
                            {task.targetDate && <span>Due {task.targetDate}</span>}
                            {task.remainingWork !== undefined && <span>{task.remainingWork}h remaining</span>}
                          </div>
                        </div>
                        <Badge
                          variant={
                            task.state.toLowerCase() === 'closed'
                              ? 'success'
                              : task.state.toLowerCase() === 'active'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {task.state}
                        </Badge>
                      </article>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card
              title="Today's pull requests"
              subtitle="GitHub work linked to delivery evidence"
              className="work-panel work-delivery-panel"
            >
              {!selectedPersonKey ? (
                <div className="work-empty-state compact">
                  <GitBranch size={20} aria-hidden="true" />
                  <p>Select a team member to review pull requests.</p>
                </div>
              ) : selectedMemberPrs?.pullRequests && selectedMemberPrs.pullRequests.length > 0 ? (
                <div className="work-pr-list">
                  <div className="work-pr-summary">
                    <strong>{selectedMemberPrs.totalCount}</strong>
                    <span>
                      {selectedMemberPrs.openCount} open · {selectedMemberPrs.mergedCount} merged
                    </span>
                  </div>
                  {selectedMemberPrs.pullRequests.map((pr) => (
                    <article key={pr.id} className="work-pr-row">
                      <div>
                        <a href={pr.htmlUrl} target="_blank" rel="noopener noreferrer">
                          <span>#{pr.number}</span> {pr.title}
                        </a>
                        <p>{pr.repository}</p>
                      </div>
                      <Badge variant={pr.state === 'merged' ? 'success' : 'info'}>{pr.state}</Badge>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="work-empty-state compact">
                  <GitBranch size={20} aria-hidden="true" />
                  <p>No pull requests recorded for {selectedMember?.name || 'this team member'} today.</p>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Ad-Hoc Task Modal */}
      <Modal
        isOpen={adHocModalOpen}
        onClose={() => setAdHocModalOpen(false)}
        title="Add a task"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdHocModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateAdHoc}>
              Add task
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
              required
              className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
            >
              <option value="" disabled>
                Choose a team member
              </option>
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
                disabled={isViewer || !eodPreview.canExecute}
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
            <div className={`p-3 rounded text-xs ${
              eodPreview.canExecute
                ? 'bg-emerald-950/20 border border-emerald-800 text-emerald-300'
                : 'bg-amber-950/20 border border-amber-800 text-amber-300'
            }`}>
              {eodPreview.canExecute
                ? 'Dry run completed. Closure-ready tasks can now be executed.'
                : 'Dry run found no closure-ready tasks. Resolve required-evidence or review blockers first.'}
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
