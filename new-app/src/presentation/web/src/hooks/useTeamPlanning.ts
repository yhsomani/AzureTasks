import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import type {
  TeamMember,
  WorkCalendarConfig,
  PlanTasksResult,
  WorkItemTask,
} from '../types/index.js';

export function useTeamPlanning() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [calendar, setCalendar] = useState<WorkCalendarConfig>({
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    exceptions: [],
  });
  const [matrixTasks, setMatrixTasks] = useState<WorkItemTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected Scope for Planning
  const [selectedPersonKeys, setSelectedPersonKeys] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(true);
  const [thursdayMode, setThursdayMode] = useState(false);

  // Plan Token & Preview State
  const [pendingPlan, setPendingPlan] = useState<PlanTasksResult | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<unknown>(null);

  // Accordion open/close state for mobile (<768px)
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleAccordion = (key: string) => {
    setExpandedCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const expandAllAccordions = () => {
    const next: Record<string, boolean> = {};
    for (const m of members) {
      next[m.key] = true;
    }
    setExpandedCards(next);
  };

  const collapseAllAccordions = () => {
    setExpandedCards({});
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [configRes, calRes, explorerRes] = await Promise.all([
        api.get<{ people?: TeamMember[] }>('/api/config'),
        api.get<WorkCalendarConfig>('/api/calendar').catch(() => ({
          workingDays: [1, 2, 3, 4, 5],
          holidays: [],
          exceptions: [],
        })),
        api.get<{ items?: WorkItemTask[] }>('/api/explorer').catch(() => ({ items: [] })),
      ]);

      const team = configRes.people || [];
      setMembers(team);
      setCalendar(calRes);
      setMatrixTasks(explorerRes.items || []);

      setSelectedPersonKeys(team.map((m) => m.key));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load team planning data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Request Plan Preview (generates PlanToken)
  const runPlanPreview = async () => {
    if (!selectAll && selectedPersonKeys.length === 0) {
      throw new Error('Select at least one team member');
    }
    setIsPlanning(true);
    setError(null);
    try {
      const payload = selectAll
        ? { all: true, thursdayMode }
        : { personKeys: selectedPersonKeys, all: false, thursdayMode };

      const res = await api.post<PlanTasksResult>('/api/tasks/plan', payload);
      setPendingPlan(res);
      setExecutionResult(null);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to calculate plan preview';
      setError(msg);
      throw err;
    } finally {
      setIsPlanning(false);
    }
  };

  // Execute Approved Plan
  const executePlan = async () => {
    if (!pendingPlan) {
      throw new Error('Review an up-to-date plan before executing');
    }
    setIsExecuting(true);
    setError(null);
    try {
      const res = await api.post('/api/tasks/execute', {
        planToken: pendingPlan.planToken,
        all: selectAll,
        personKeys: selectAll ? undefined : selectedPersonKeys,
        confirm: true,
        thursdayMode,
      });
      setExecutionResult(res);
      setPendingPlan(null);
      await loadData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      setError(msg);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  };

  // Add / Update Team Member
  const saveMember = async (member: TeamMember) => {
    const updatedList = members.some((m) => m.key === member.key)
      ? members.map((m) => (m.key === member.key ? member : m))
      : [...members, member];

    await api.post('/api/config/people', { people: updatedList });
    await loadData();
  };

  return {
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
    refresh: loadData,
  };
}
