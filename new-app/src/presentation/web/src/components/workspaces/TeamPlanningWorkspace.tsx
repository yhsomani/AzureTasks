import React, { useState } from 'react';
import { useTeamPlanning } from '../../hooks/useTeamPlanning.js';
import { Card } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { Badge } from '../common/Badge.js';
import { Modal } from '../common/Modal.js';
import { Skeleton } from '../common/Skeleton.js';
import type { SubViewId, TeamMember } from '../../types/index.js';

export function TeamPlanningWorkspace({
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
    calendar,
    matrixTasks,
    isLoading,
    error,
    selectedPersonKeys,
    setSelectedPersonKeys,
    selectAll,
    setSelectAll,
    thursdayMode,
    setThursdayMode,
    pendingPlan,
    isPlanning,
    isExecuting,
    executionResult,
    expandedCards,
    toggleAccordion,
    expandAllAccordions,
    collapseAllAccordions,
    runPlanPreview,
    executePlan,
    saveMember,
  } = useTeamPlanning();

  // Add Member Modal
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Partial<TeamMember>>({
    name: '',
    email: '',
    role: 'Developer',
    capacityHours: 8,
    enabled: true,
  });

  const handlePlanPreview = async () => {
    try {
      await runPlanPreview();
      onNotify('Plan preview generated successfully! Review below before executing.', 'success');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Plan preview failed', 'error');
    }
  };

  const handleExecute = async () => {
    if (isViewer) {
      onNotify('Read-only viewer credentials cannot change tasks', 'error');
      return;
    }
    try {
      await executePlan();
      onNotify('Plan executed successfully in Azure DevOps!', 'success');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Plan execution failed', 'error');
    }
  };

  const handleMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember.name || !editingMember.email) {
      onNotify('Name and email are required', 'error');
      return;
    }
    try {
      const key = editingMember.key || editingMember.email.split('@')[0].toLowerCase();
      await saveMember({
        key,
        name: editingMember.name,
        email: editingMember.email,
        role: editingMember.role || 'Developer',
        capacityHours: Number(editingMember.capacityHours) || 8,
        githubUsername: editingMember.githubUsername,
        enabled: editingMember.enabled !== false,
      });
      onNotify('Team member saved successfully!', 'success');
      setMemberModalOpen(false);
      setEditingMember({ name: '', email: '', role: 'Developer', capacityHours: 8, enabled: true });
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Failed to save member', 'error');
    }
  };

  const toggleMemberSelection = (key: string) => {
    if (selectAll) {
      setSelectAll(false);
      setSelectedPersonKeys(members.map((m) => m.key).filter((k) => k !== key));
      return;
    }
    if (selectedPersonKeys.includes(key)) {
      setSelectedPersonKeys(selectedPersonKeys.filter((k) => k !== key));
    } else {
      const next = [...selectedPersonKeys, key];
      setSelectedPersonKeys(next);
      if (next.length === members.length && members.length > 0) {
        setSelectAll(true);
      }
    }
  };

  return (
    <div className="team-planning-workspace space-y-6">
      {/* Scope & Plan Configuration Bar */}
      <Card
        title="Sprint Planning & Immutable Execution Protocol"
        subtitle="Review rolling sprint tasks, inspect signed plan tokens, and execute safely"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-text select-none min-h-[44px]">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={(e) => {
                  setSelectAll(e.target.checked);
                  if (e.target.checked) {
                    setSelectedPersonKeys(members.map((m) => m.key));
                  }
                }}
                className="rounded border-border text-accent focus:ring-accent"
              />
              <span>Select All Members</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-text select-none min-h-[44px]">
              <input
                type="checkbox"
                checked={thursdayMode}
                onChange={(e) => setThursdayMode(e.target.checked)}
                className="rounded border-border text-accent focus:ring-accent"
              />
              <span>Thursday Mode</span>
            </label>

            <Button
              variant="secondary"
              id="planPreviewBtn"
              onClick={handlePlanPreview}
              isLoading={isPlanning}
              className="font-semibold"
            >
              Calculate Plan Preview
            </Button>

            {pendingPlan && (
              <Button
                variant="primary"
                id="executeBtn"
                onClick={handleExecute}
                isLoading={isExecuting}
                disabled={isViewer}
                className="font-bold"
              >
                Execute Approved Plan ({pendingPlan.summary?.totalPlanned || 0} tasks)
              </Button>
            )}
          </div>
        }
      >
        <p className="text-xs text-text-muted">
          Under the Immutable Plan Protocol, task previews generate a cryptographically signed HMAC PlanToken valid for 10 minutes. Execution uses the exact approved snapshot to prevent drift.
        </p>

        {/* Plan Token & Signed Summary Callout */}
        {pendingPlan && (
          <div className="mt-4 p-4 bg-surface-base border border-accent/40 rounded-lg space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-sm text-accent">
                Plan Token Generated (HMAC-SHA256)
              </span>
              <Badge variant="success">Expires in ~10m</Badge>
            </div>
            <div className="font-mono text-xs text-text-muted truncate">
              Token: {pendingPlan.planToken}
            </div>
            <div className="flex items-center gap-4 text-xs text-text pt-1">
              <span>Planned Tasks: <strong>{pendingPlan.summary?.totalPlanned || 0}</strong></span>
              <span>Team Members: <strong>{pendingPlan.summary?.personCount || 0}</strong></span>
              {pendingPlan.planHash && (
                <span className="font-mono text-text-muted">Hash: {pendingPlan.planHash.slice(0, 16)}…</span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Task Coverage: Desktop Matrix Table vs Mobile Card Accordion */}
      <Card
        title="Team Allocation & Coverage"
        subtitle="Desktop 14-day multi-day matrix and responsive mobile card accordion"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={expandAllAccordions}
              className="md:hidden min-h-[44px] min-w-[44px]"
            >
              Expand All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={collapseAllAccordions}
              className="md:hidden min-h-[44px] min-w-[44px]"
            >
              Collapse All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMemberModalOpen(true)}
              disabled={isViewer}
            >
              + Add Member
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <Skeleton count={6} />
        ) : error ? (
          <p className="text-sm text-danger p-4">{error}</p>
        ) : members.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">
            No team members configured. Please add team members to start planning.
          </div>
        ) : (
          <>
            {/* Desktop View: Multi-day Matrix Table (hidden on viewports < 768px) */}
            <div
              className="matrix-desktop-container table-wrap overflow-x-auto hidden md:block"
              id="plannerMatrix"
            >
              <table className="table w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border bg-surface-base">
                    <th className="p-3 font-semibold text-text">Team Member</th>
                    <th className="p-3 font-semibold text-text">Role</th>
                    <th className="p-3 font-semibold text-text">Daily Capacity</th>
                    <th className="p-3 font-semibold text-text">Status</th>
                    <th className="p-3 font-semibold text-text">Select</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => {
                    const isSelected = selectAll || selectedPersonKeys.includes(member.key);
                    const memberTasks = matrixTasks.filter((t) => t.assignedTo?.includes(member.name));

                    return (
                      <tr key={member.key} className="hover:bg-surface-card transition-colors">
                        <td className="p-3 font-medium text-text">
                          <div>
                            <span>{member.name}</span>
                            <span className="block text-[11px] text-text-muted">{member.email}</span>
                          </div>
                        </td>
                        <td className="p-3 text-text-muted">{member.role}</td>
                        <td className="p-3 text-text">
                          {member.capacityHours === 0 ? (
                            <Badge variant="warning">ON LEAVE</Badge>
                          ) : (
                            `${member.capacityHours}h / day`
                          )}
                        </td>
                        <td className="p-3">
                          <Badge variant={member.enabled ? 'success' : 'neutral'}>
                            {member.enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <label className="flex items-center justify-center min-h-[44px] min-w-[44px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              aria-label={`Select ${member.name} for planning`}
                              onChange={() => toggleMemberSelection(member.key)}
                              className="rounded border-border text-accent focus:ring-accent min-h-[24px] min-w-[24px]"
                            />
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View: Responsive Card Accordion (<768px) */}
            <div
              className="card-accordion-mobile flex flex-col gap-3 md:hidden"
              id="plannerCardAccordion"
            >
              {members.map((member) => {
                const isExpanded = !!expandedCards[member.key];
                const isOnLeave = member.capacityHours === 0;
                const isSelected = selectAll || selectedPersonKeys.includes(member.key);
                const memberTasks = matrixTasks.filter((t) => t.assignedTo?.includes(member.name));

                return (
                  <div
                    key={member.key}
                    className="accordion-card bg-surface-base border border-border rounded-lg p-4 transition-colors"
                  >
                    {/* Accessible Header: Sibling Checkbox and Accordion Toggle Button */}
                    <div className="flex items-center justify-between w-full gap-2">
                      <label
                        className="flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          aria-label={`Select ${member.name} for planning`}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleMemberSelection(member.key);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-border text-accent focus:ring-accent min-h-[24px] min-w-[24px]"
                        />
                      </label>

                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`accordion-body-${member.key}`}
                        onClick={() => toggleAccordion(member.key)}
                        className="accordion-header flex-1 flex items-center justify-between text-left min-h-[44px] min-w-[44px]"
                      >
                        <div>
                          <h4 className="font-semibold text-sm text-text">{member.name}</h4>
                          <span className="text-xs text-text-muted">{member.role}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {isOnLeave ? (
                            <Badge variant="warning">ON LEAVE</Badge>
                          ) : (
                            <Badge variant="info">{member.capacityHours}h</Badge>
                          )}
                          <span aria-hidden="true" className="text-text-muted text-sm font-bold">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* Collapsible Accordion Body */}
                    {isExpanded && (
                      <div
                        id={`accordion-body-${member.key}`}
                        className="accordion-body mt-3 pt-3 border-t border-border space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-text-muted">
                          <span>Email: {member.email}</span>
                          {member.githubUsername && <span>GitHub: @{member.githubUsername}</span>}
                        </div>

                        <div className="mt-2 space-y-1">
                          <span className="font-semibold text-text block">Allocated Work Items:</span>
                          {memberTasks.length === 0 ? (
                            <p className="text-text-muted italic">No active tasks in current window.</p>
                          ) : (
                            memberTasks.map((t) => (
                              <div
                                key={t.id}
                                className="p-2 bg-surface rounded border border-border flex items-center justify-between"
                              >
                                <span className="task-title font-medium text-text">
                                  #{t.id} {t.title}
                                </span>
                                <Badge variant={t.state === 'Closed' ? 'success' : 'neutral'}>
                                  {t.state}
                                </Badge>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Team Roster & Work Calendar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Work Calendar & Working Days */}
        <Card title="Work Calendar & Exceptions" subtitle="Standard working days and configured holiday rules">
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 bg-surface-base border border-border rounded">
              <span className="font-semibold text-text">Standard Working Days</span>
              <span className="text-text-muted">Monday – Friday</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-surface-base border border-border rounded">
              <span className="font-semibold text-text">Configured Holidays</span>
              <span className="text-text-muted">{calendar.holidays?.length || 0} dates</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-surface-base border border-border rounded">
              <span className="font-semibold text-text">Member Exceptions</span>
              <span className="text-text-muted">{calendar.exceptions?.length || 0} exceptions</span>
            </div>
          </div>
        </Card>

        {/* Sprint Summary */}
        <Card title="Planning Guidance" subtitle="Rules enforced during task planning">
          <ul className="text-xs text-text-muted space-y-2 list-disc list-inside">
            <li>Tasks are planned within the rolling sprint window for all active team members.</li>
            <li>Weekends and configured public holidays are automatically skipped.</li>
            <li>Members marked with 0h daily capacity are flagged as ON LEAVE and skipped.</li>
            <li>Duplicate tasks for the same member on the same target date are rejected.</li>
          </ul>
        </Card>
      </div>

      {/* Add / Edit Member Modal */}
      <Modal
        isOpen={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        title="Add Team Member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemberModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleMemberSubmit}>
              Save Member
            </Button>
          </>
        }
      >
        <form onSubmit={handleMemberSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text mb-1" htmlFor="m-name">
              Full Name
            </label>
            <input
              id="m-name"
              type="text"
              required
              value={editingMember.name || ''}
              onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
              className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text mb-1" htmlFor="m-email">
              Corporate Email
            </label>
            <input
              id="m-email"
              type="email"
              required
              value={editingMember.email || ''}
              onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
              className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text mb-1" htmlFor="m-role">
                Role
              </label>
              <select
                id="m-role"
                value={editingMember.role || 'Developer'}
                onChange={(e) => setEditingMember({ ...editingMember, role: e.target.value })}
                className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
              >
                <option value="Lead">Lead</option>
                <option value="Developer">Developer</option>
                <option value="QA">QA</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1" htmlFor="m-hours">
                Daily Hours
              </label>
              <input
                id="m-hours"
                type="number"
                min="0"
                max="24"
                value={editingMember.capacityHours ?? 8}
                onChange={(e) => setEditingMember({ ...editingMember, capacityHours: Number(e.target.value) })}
                className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text mb-1" htmlFor="m-github">
              GitHub Username (optional)
            </label>
            <input
              id="m-github"
              type="text"
              value={editingMember.githubUsername || ''}
              onChange={(e) => setEditingMember({ ...editingMember, githubUsername: e.target.value })}
              placeholder="e.g. octocat"
              className="w-full bg-surface-base border border-border text-text rounded p-2 text-sm min-h-[44px]"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
