import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import type { JournalEntry, SchedulerJobStatus, SystemHealthStatus } from '../types/index.js';

export function useGovernance() {
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJobStatus[]>([]);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state for journal
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('ALL');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [journalRes, schedRes, healthRes] = await Promise.all([
        api.get<{ entries?: JournalEntry[] }>('/api/journal').catch(() => ({ entries: [] })),
        api.get<{ running?: boolean; jobs?: SchedulerJobStatus[] }>('/api/scheduler').catch(() => ({
          running: true,
          jobs: [],
        })),
        api.get<SystemHealthStatus>('/api/health').catch(() => null),
      ]);

      setJournalEntries(journalRes.entries || []);
      setSchedulerRunning(!!schedRes.running);
      setSchedulerJobs(schedRes.jobs || []);
      setHealth(healthRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load governance data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Scheduler Actions
  const toggleScheduler = async (enable: boolean) => {
    if (enable && !window.confirm('Enable automated task operations according to schedule?')) {
      return;
    }
    await api.post('/api/scheduler/toggle', { enabled: enable });
    await loadData();
  };

  const triggerSchedulerRun = async () => {
    if (!window.confirm('Run the scheduled task creation now for candidate dates?')) {
      return;
    }
    const res = await api.post('/api/scheduler/run-now', {});
    await loadData();
    return res;
  };

  const filteredEntries = journalEntries.filter((entry) => {
    const matchesSearch =
      !searchQuery ||
      entry.operator?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      JSON.stringify(entry.details || {}).toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAction = selectedAction === 'ALL' || entry.action === selectedAction;
    return matchesSearch && matchesAction;
  });

  return {
    journalEntries: filteredEntries,
    totalJournalCount: journalEntries.length,
    schedulerJobs,
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
    refresh: loadData,
  };
}
