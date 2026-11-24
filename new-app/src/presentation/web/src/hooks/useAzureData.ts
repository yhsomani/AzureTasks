import { useState, useEffect, useCallback, useRef } from 'react';
import { azureDataApi, api } from '../api/client.js';
import type {
  AzureOverviewResponse,
  BuildHealthRecord,
  PipelineRunRecord,
  ReleaseRecord,
  TestHealthRecord,
  AzureTeamSummary,
  WorkItemSummary,
} from '../types/index.js';

export interface UseAzureDataOptions {
  autoFetch?: boolean;
}

export function useAzureData(options: UseAzureDataOptions = { autoFetch: true }) {
  const [overview, setOverview] = useState<AzureOverviewResponse | null>(null);
  const [buildHealth, setBuildHealth] = useState<BuildHealthRecord[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRunRecord[]>([]);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [testHealth, setTestHealth] = useState<TestHealthRecord[]>([]);
  const [teams, setTeams] = useState<AzureTeamSummary[]>([]);
  const [totalTeamsCount, setTotalTeamsCount] = useState<number>(0);
  const [unassignedWorkItems, setUnassignedWorkItems] = useState<WorkItemSummary[]>([]);
  const [unassignedCount, setUnassignedCount] = useState<number>(0);
  const [unassignedSearchQuery, setUnassignedSearchQuery] = useState<string>('');

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [buildLimit, setBuildLimit] = useState<number>(20);
  const [teamSearchQuery, setTeamSearchQuery] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Ref tracking latest search query without triggering callback invalidation
  const teamSearchQueryRef = useRef<string>(teamSearchQuery);
  teamSearchQueryRef.current = teamSearchQuery;

  // Ref tracking active AbortController for live search
  const teamsAbortControllerRef = useRef<AbortController | null>(null);

  // Ref tracking first mount to prevent duplicate teams fetch on initial render
  const isFirstMountRef = useRef<boolean>(true);

  const fetchOverview = useCallback(async () => {
    try {
      const data = await azureDataApi.getOverview();
      setOverview(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch overview';
      setError(msg);
    }
  }, []);

  const fetchBuildsAndTelemetry = useCallback(async () => {
    try {
      const [bRes, rRes, tRes, relRes] = await Promise.all([
        azureDataApi.getBuildHealth({
          projectId: selectedProjectId || undefined,
          limit: buildLimit,
        }),
        azureDataApi.getPipelineRuns({
          projectId: selectedProjectId || undefined,
          limit: 15,
        }),
        azureDataApi.getTestHealth(),
        azureDataApi.getReleases({
          projectId: selectedProjectId || undefined,
          limit: 10,
        }),
      ]);

      setBuildHealth(bRes.buildHealth || []);
      setPipelineRuns(rRes.pipelineRuns || []);
      setTestHealth(tRes.testHealth || []);
      setReleases(relRes.releases || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch build telemetry';
      setError(msg);
    }
  }, [selectedProjectId, buildLimit]);

  // Decoupled fetchTeams: accepts explicit query and AbortSignal; does NOT depend on teamSearchQuery
  const fetchTeams = useCallback(
    async (searchQuery?: string, signal?: AbortSignal) => {
      const activeSearch = searchQuery !== undefined ? searchQuery : teamSearchQueryRef.current;
      try {
        const res = await azureDataApi.getTeams(
          {
            projectId: selectedProjectId || undefined,
            search: activeSearch || undefined,
            limit: 100,
          },
          { signal }
        );

        if (!signal?.aborted) {
          setTeams(res.teams || []);
          // Invariant: ONLY update totalTeamsCount on unfiltered global queries
          if (!activeSearch && !selectedProjectId && res.totalCount !== undefined && res.totalCount > 0) {
            setTotalTeamsCount(res.totalCount);
          }
        }
      } catch (err: unknown) {
        if (signal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message.includes('timed out')))) {
          return; // Ignore canceled in-flight search requests
        }
        const msg = err instanceof Error ? err.message : 'Failed to fetch teams';
        setError(msg);
      }
    },
    [selectedProjectId]
  );

  const fetchUnassignedWorkItems = useCallback(
    async (projectId?: string, limit: number = 50) => {
      try {
        const res = await azureDataApi.getUnassignedWorkItems({
          projectId: projectId !== undefined ? projectId : (selectedProjectId || undefined),
          limit,
        });
        setUnassignedWorkItems(res.workItems || []);
        setUnassignedCount(res.count || 0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch unassigned work items';
        setError(msg);
      }
    },
    [selectedProjectId]
  );

  // refreshAll does NOT depend on teamSearchQuery!
  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    api.invalidateCache('/api/azure-data');
    try {
      await Promise.all([
        fetchOverview(),
        fetchBuildsAndTelemetry(),
        fetchTeams(),
        fetchUnassignedWorkItems(),
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchOverview, fetchBuildsAndTelemetry, fetchTeams, fetchUnassignedWorkItems]);

  // Mount effect: only fires on mount or when refreshAll identity changes (e.g. projectId changes)
  useEffect(() => {
    if (options.autoFetch) {
      refreshAll();
    }
  }, [refreshAll, options.autoFetch]);

  // Dedicated 250ms debounced search effect with AbortController cancellation
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }

    if (teamsAbortControllerRef.current) {
      teamsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    teamsAbortControllerRef.current = controller;

    const timer = setTimeout(() => {
      fetchTeams(teamSearchQuery, controller.signal);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [teamSearchQuery, fetchTeams]);

  return {
    overview,
    buildHealth,
    pipelineRuns,
    releases,
    testHealth,
    teams,
    totalTeamsCount,
    unassignedWorkItems,
    unassignedCount,
    unassignedSearchQuery,
    setUnassignedSearchQuery,
    selectedProjectId,
    setSelectedProjectId,
    buildLimit,
    setBuildLimit,
    teamSearchQuery,
    setTeamSearchQuery,
    isLoading,
    error,
    refreshAll,
    fetchTeams,
    fetchUnassignedWorkItems,
  };
}
