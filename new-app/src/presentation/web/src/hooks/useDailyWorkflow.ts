import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import type { TeamMember, PersonPrSummary, WorkItemTask } from '../types/index.js';

export function useDailyWorkflow() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedPersonKey, setSelectedPersonKey] = useState<string>('');
  const [myTasks, setMyTasks] = useState<WorkItemTask[]>([]);
  const [prSummaries, setPrSummaries] = useState<PersonPrSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // EOD State: preview before execute
  const [eodPreview, setEodPreview] = useState<{
    ready: boolean;
    data: unknown;
    timestamp?: number;
  }>({ ready: false, data: null });

  // Load members and PR deliverables
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const configRes = await api.get<{ people?: TeamMember[] }>('/api/config');
      const teamList = configRes.people || [];
      setMembers(teamList);

      if (teamList.length > 0 && !selectedPersonKey) {
        setSelectedPersonKey(teamList[0].key);
      }

      // Fetch GitHub PR deliverables
      try {
        const prRes = await api.get<{ members?: PersonPrSummary[] }>('/api/github/daily-prs');
        if (prRes.members) {
          setPrSummaries(prRes.members);
        }
      } catch {
        // Non-blocking PR sync error
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load daily workflow data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedPersonKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load tasks for selected person
  useEffect(() => {
    if (!selectedPersonKey) return;
    let active = true;

    api
      .get<{ items?: WorkItemTask[] }>(`/api/explorer?personKeys=${encodeURIComponent(selectedPersonKey)}`)
      .then((res) => {
        if (active && res.items) {
          setMyTasks(res.items);
        }
      })
      .catch(() => {
        if (active) setMyTasks([]);
      });

    return () => {
      active = false;
    };
  }, [selectedPersonKey]);

  // Action: Morning Activation
  const activateDailyTasks = async () => {
    const res = await api.post<{ activatedCount?: number }>('/api/tasks/activate-today', {
      all: true,
      confirm: true,
    });
    await loadData();
    return res;
  };

  // Action: EOD Closure Preview (Dry Run)
  const previewEodClosure = async (asOf?: string) => {
    const res = await api.post('/api/tasks/close-today', {
      dryRun: true,
      asOf: asOf || new Date().toISOString().slice(0, 10),
    });
    setEodPreview({
      ready: true,
      data: res,
      timestamp: Date.now(),
    });
    return res;
  };

  // Action: EOD Closure Execute
  const executeEodClosure = async (asOf?: string) => {
    if (!eodPreview.ready) {
      throw new Error('Preview EOD closure before executing.');
    }
    const res = await api.post('/api/tasks/close-today', {
      dryRun: false,
      confirm: true,
      asOf: asOf || new Date().toISOString().slice(0, 10),
    });
    setEodPreview({ ready: false, data: null });
    await loadData();
    return res;
  };

  // Action: Ad-Hoc Task Creation
  const createAdHocTask = async (params: {
    personKey: string;
    targetIsoDate: string;
    customTitle: string;
    originalEstimate?: number;
    activity?: string;
  }) => {
    const res = await api.post('/api/tasks/adhoc', {
      ...params,
      confirm: true,
    });
    await loadData();
    return res;
  };

  return {
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
    refresh: loadData,
  };
}
