import React, { useState, useMemo } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Button } from '../common/Button.js';
import { Skeleton } from '../common/Skeleton.js';
import type { WorkItemSummary } from '../../types/index.js';

export interface UnassignedTaskManagerProps {
  workItems: WorkItemSummary[];
  totalCount: number;
  isLoading: boolean;
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  onRefresh: () => void;
}

export function UnassignedTaskManager({
  workItems,
  totalCount,
  isLoading,
  selectedProjectId,
  onSelectProject,
  onRefresh,
}: UnassignedTaskManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const safeWorkItems = useMemo(
    () => (Array.isArray(workItems) ? workItems : []),
    [workItems]
  );

  // Extract distinct work item types for filtering
  const distinctTypes = useMemo(() => {
    const types = new Set<string>();
    safeWorkItems.forEach((item) => {
      if (item?.type) types.add(item.type);
    });
    return Array.from(types).sort();
  }, [safeWorkItems]);

  // Client-side search and type filtering
  const filteredItems = useMemo(() => {
    let result = safeWorkItems;

    if (typeFilter) {
      result = result.filter(
        (item) => item?.type?.toLowerCase() === typeFilter.toLowerCase()
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          String(item.workItemId || item.id || '').includes(q) ||
          item.title?.toLowerCase().includes(q) ||
          item.type?.toLowerCase().includes(q) ||
          item.areaPath?.toLowerCase().includes(q) ||
          item.iterationPath?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [safeWorkItems, searchQuery, typeFilter]);

  const getTypeBadgeVariant = (type?: string | null): 'info' | 'danger' | 'warning' | 'success' | 'neutral' => {
    const t = (type || '').toLowerCase();
    if (t.includes('bug')) return 'danger';
    if (t.includes('story')) return 'info';
    if (t.includes('feature')) return 'success';
    if (t.includes('task')) return 'neutral';
    return 'warning';
  };

  const getProjectDisplayName = (projectId?: string | null) => {
    if (!projectId) return 'Default Project';
    if (projectId === 'd07e3437-8c91-4438-8719-7a9a126582db' || projectId.includes('Agile')) {
      return '3in1_Agile_Projects';
    }
    if (projectId === 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe' || projectId.includes('AppFrontEnd')) {
      return '3_in_1_AppFrontEnd_Tasks';
    }
    return projectId;
  };

  return (
    <Card
      title="Unassigned Tasks & Backlog Discovery"
      subtitle="Discover and triage backlog items without assigned owners across Azure DevOps projects"
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="neutral">
            {totalCount > 0 ? `${totalCount} Total Unassigned` : `${filteredItems.length} Tasks`}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            isLoading={isLoading}
            aria-label="Refresh unassigned tasks"
          >
            Refresh
          </Button>
        </div>
      }
    >
      {/* Filtering and Search Controls */}
      <div className="space-y-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-text">
              <span className="font-medium text-text-muted">Project:</span>
              <select
                aria-label="Filter unassigned tasks by project"
                value={selectedProjectId}
                onChange={(e) => onSelectProject(e.target.value)}
                className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text min-h-[44px]"
              >
                <option value="">All Projects (Combined)</option>
                <option value="a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe">
                  3_in_1_AppFrontEnd_Tasks
                </option>
                <option value="d07e3437-8c91-4438-8719-7a9a126582db">
                  3in1_Agile_Projects
                </option>
              </select>
            </label>

            {distinctTypes.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-text">
                <span className="font-medium text-text-muted">Type:</span>
                <select
                  aria-label="Filter unassigned tasks by type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text min-h-[44px]"
                >
                  <option value="">All Types</option>
                  {distinctTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="text-xs text-text-muted">
            Showing {filteredItems.length} of {safeWorkItems.length} loaded
          </div>
        </div>

        {/* Search Input */}
        <div>
          <input
            type="text"
            aria-label="Search unassigned tasks"
            placeholder="Search by task ID, title, work item type, or area path..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded px-4 py-2 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]"
          />
        </div>
      </div>

      {/* Content Table */}
      {isLoading && safeWorkItems.length === 0 ? (
        <Skeleton count={4} />
      ) : filteredItems.length === 0 ? (
        <div className="py-8 text-center text-text-muted text-sm border border-dashed border-border rounded-lg">
          {searchQuery || typeFilter
            ? 'No unassigned tasks match your active filters.'
            : 'No unassigned work items found in this project backlog.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text" aria-label="Unassigned work items table">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted uppercase">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Title</th>
                <th className="py-2.5 px-3">Project</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Area / Iteration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.map((item) => {
                const id = item?.workItemId || item?.id || 0;
                return (
                  <tr key={id} className="hover:bg-surface-card transition-colors">
                    <td className="py-2.5 px-3 text-xs font-mono text-text-muted whitespace-nowrap">
                      #{id}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge variant={getTypeBadgeVariant(item?.type || '')}>
                        {item?.type || 'Task'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-text max-w-md">
                      <div className="line-clamp-2" title={item?.title || ''}>
                        {item?.title || ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-text-muted whitespace-nowrap">
                      {getProjectDisplayName(item?.projectId)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge variant={item?.state === 'Active' ? 'success' : 'neutral'}>
                        {item?.state || 'New'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-text-muted whitespace-nowrap">
                      <div>{item?.areaPath || '—'}</div>
                      <div className="text-[11px] text-text-muted opacity-80">{item?.iterationPath || ''}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
