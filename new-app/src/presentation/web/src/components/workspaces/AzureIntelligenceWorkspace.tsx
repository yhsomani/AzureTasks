import React from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Button } from '../common/Button.js';
import { Skeleton } from '../common/Skeleton.js';
import { type ToastMessage } from '../common/Toast.js';
import { UnassignedTaskManager } from './UnassignedTaskManager.js';
import { useAzureData } from '../../hooks/useAzureData.js';
import type { SubViewId, AzureTeamSummary, BuildHealthRecord } from '../../types/index.js';

export interface AzureIntelligenceWorkspaceProps {
  subView: SubViewId;
  onNotify?: (message: string, type?: ToastMessage['type']) => void;
}

export function AzureIntelligenceWorkspace({
  subView,
  onNotify,
}: AzureIntelligenceWorkspaceProps) {
  const {
    overview,
    buildHealth,
    pipelineRuns,
    testHealth,
    teams,
    totalTeamsCount,
    unassignedWorkItems,
    unassignedCount,
    selectedProjectId,
    setSelectedProjectId,
    buildLimit,
    setBuildLimit,
    teamSearchQuery,
    setTeamSearchQuery,
    isLoading,
    error,
    refreshAll,
    fetchUnassignedWorkItems,
  } = useAzureData();

  // Compute aggregated totals from overview if available
  const totals = React.useMemo(() => {
    if (!overview || !overview.projects) {
      return {
        builds: 0,
        pipelines: 0,
        releases: 0,
        testRuns: 0,
        teams: totalTeamsCount || 0,
      };
    }
    const agg = overview.projects.reduce(
      (acc, p) => {
        acc.builds += p.builds || 0;
        acc.pipelines += p.pipelines || 0;
        acc.releases += p.releases || 0;
        acc.testRuns += p.testRuns || 0;
        return acc;
      },
      { builds: 0, pipelines: 0, releases: 0, testRuns: 0, teams: 0 }
    );
    if (totalTeamsCount > 0) {
      agg.teams = totalTeamsCount;
    }
    return agg;
  }, [overview, totalTeamsCount]);

  const formatKpi = (val: number, decimals: number = 1) => {
    if (val >= 1000) {
      return `${(val / 1000).toFixed(decimals)}k`;
    }
    return String(val);
  };

  const handleRefresh = async () => {
    await refreshAll();
    onNotify?.('Delivery data refreshed', 'success');
  };

  const parseTeamDescription = (desc: string | null) => {
    if (!desc) return null;
    try {
      if (desc.trim().startsWith('{')) {
        return JSON.parse(desc);
      }
    } catch {
      // not JSON
    }
    return null;
  };

  const isUnassignedOnly = subView === 'unassigned';
  const showAll = subView === 'azure-overview' || (!['azure-builds', 'azure-teams', 'unassigned'].includes(subView));
  const showBuilds = (showAll || subView === 'azure-builds') && !isUnassignedOnly;
  const showTeams = (showAll || subView === 'azure-teams') && !isUnassignedOnly;
  const showUnassigned = showAll || isUnassignedOnly;

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text">Project delivery health</h2>
          <p className="text-sm text-text-muted">
            Build, pipeline, test, and team activity from your connected Azure DevOps projects.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={handleRefresh}
            isLoading={isLoading}
            aria-label="Refresh project delivery data"
          >
            Refresh data
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={handleRefresh}>
            Retry
          </Button>
        </div>
      )}

      {/* 5 Executive KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="kpi-card text-center p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
            Total Builds
          </span>
          <span className="text-2xl font-bold text-text block" id="reactKpiBuilds">
            {formatKpi(totals.builds, 1)}
          </span>
          <span className="text-xs text-text-muted mt-1 block">
            {totals.builds > 0 ? `${formatKpi(totals.builds, 1)} recorded runs` : 'Recorded executions'}
          </span>
        </Card>

        <Card className="kpi-card text-center p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
            Pipelines
          </span>
          <span className="text-2xl font-bold text-text block" id="reactKpiPipelines">
            {totals.pipelines}
          </span>
          <span className="text-xs text-text-muted mt-1 block">Active definitions</span>
        </Card>

        <Card className="kpi-card text-center p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
            Total Releases
          </span>
          <span className="text-2xl font-bold text-text block" id="reactKpiReleases">
            {formatKpi(totals.releases, 1)}
          </span>
          <span className="text-xs text-text-muted mt-1 block">
            {totals.releases > 0 ? `${formatKpi(totals.releases, 1)} deployments` : 'Pipeline deployments'}
          </span>
        </Card>

        <Card className="kpi-card text-center p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
            Test Runs
          </span>
          <span className="text-2xl font-bold text-text block" id="reactKpiTestRuns">
            {formatKpi(totals.testRuns, 0)}
          </span>
          <span className="text-xs text-text-muted mt-1 block">
            {totals.testRuns > 0 ? `${totals.testRuns.toLocaleString()} suite runs` : 'Suite runs recorded'}
          </span>
        </Card>

        <Card className="kpi-card text-center p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
            Enterprise Teams
          </span>
          <span className="text-2xl font-bold text-text block" id="reactKpiTeams">
            {totals.teams}
          </span>
          <span className="text-xs text-text-muted mt-1 block">
            {totals.teams > 0 ? `${totals.teams} Agile PODs` : 'Agile PODs configured'}
          </span>
        </Card>
      </div>

      {/* Scope Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text">
              <span className="font-medium text-text-muted">Project:</span>
              <select
                aria-label="Filter by project scope"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
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

            {showBuilds && (
              <label className="flex items-center gap-2 text-sm text-text">
                <span className="font-medium text-text-muted">Limit:</span>
                <select
                  aria-label="Filter build limit"
                  value={buildLimit}
                  onChange={(e) => setBuildLimit(Number(e.target.value))}
                  className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text min-h-[44px]"
                >
                  <option value={10}>Top 10 Definitions</option>
                  <option value={20}>Top 20 Definitions</option>
                  <option value={50}>Top 50 Definitions</option>
                </select>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">
              Live SQLite WAL indexed (&lt;15ms)
            </span>
          </div>
        </div>
      </Card>

      {/* Section 1: Build & Pipeline Health */}
      {showBuilds && (
        <Card
          title="Build Definition Success & Pipeline Reliability"
          subtitle="Real-time execution counts, pass/fail ratios, and calculated success rate per pipeline definition"
        >
          {isLoading && buildHealth.length === 0 ? (
            <Skeleton count={4} />
          ) : buildHealth.length === 0 ? (
            <p className="text-sm text-text-muted py-4">No build records found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-text" aria-label="Build health table">
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted uppercase">
                    <th className="py-2.5 px-3">Def ID</th>
                    <th className="py-2.5 px-3">Pipeline Definition</th>
                    <th className="py-2.5 px-3">Total Runs</th>
                    <th className="py-2.5 px-3">Succeeded</th>
                    <th className="py-2.5 px-3">Failed</th>
                    <th className="py-2.5 px-3">Success Rate</th>
                    <th className="py-2.5 px-3">Latest Finished</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {buildHealth.map((b: BuildHealthRecord) => {
                    const badgeVariant =
                      b.successRate >= 95
                        ? 'success'
                        : b.successRate >= 80
                        ? 'warning'
                        : 'danger';

                    return (
                      <tr key={b.definitionId} className="hover:bg-surface-card transition-colors">
                        <td className="py-2.5 px-3 text-xs text-text-muted">
                          #{b.definitionId}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-text">
                          {b.definitionName}
                        </td>
                        <td className="py-2.5 px-3">{b.totalRuns.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-emerald-400 font-medium">
                          {b.succeeded.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-rose-400 font-medium">
                          {b.failed.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant={badgeVariant}>{b.successRate}%</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-text-muted">
                          {b.latestFinishedAt
                            ? new Date(b.latestFinishedAt).toLocaleDateString()
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Section 2: Recent Pipeline Runs & Test Quality */}
      {showBuilds && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Recent Pipeline Executions" subtitle="Latest CI/CD executions and status">
            {pipelineRuns.length === 0 ? (
              <p className="text-sm text-text-muted py-4">No recent runs available.</p>
            ) : (
              <div className="space-y-3">
                {pipelineRuns.slice(0, 5).map((r) => (
                  <div
                    key={r.runId}
                    className="flex items-center justify-between p-3 rounded bg-surface-card border border-border"
                  >
                    <div>
                      <strong className="block text-sm text-text font-semibold">
                        {r.runName || `Run #${r.runId}`}
                      </strong>
                      <span className="text-xs text-text-muted">{r.pipelineName}</span>
                    </div>
                    <Badge
                      variant={
                        r.result === 'succeeded'
                          ? 'success'
                          : r.result === 'failed'
                          ? 'danger'
                          : 'warning'
                      }
                    >
                      {r.result || r.state}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Test Run Health by Project" subtitle="Automated test suite executions">
            {testHealth.length === 0 ? (
              <p className="text-sm text-text-muted py-4">No test records available.</p>
            ) : (
              <div className="space-y-3">
                {testHealth.map((th) => (
                  <div
                    key={th.projectId}
                    className="p-3 rounded bg-surface-card border border-border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <strong className="text-sm font-semibold text-text">
                        {th.projectName}
                      </strong>
                      <Badge variant="info">{th.totalRuns} Suite Runs</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 rounded bg-surface">
                        <span className="text-text-muted block">Total</span>
                        <strong className="text-text font-bold">{th.totalRuns}</strong>
                      </div>
                      <div className="p-2 rounded bg-surface">
                        <span className="text-text-muted block">Passed</span>
                        <strong className="text-emerald-400 font-bold">{th.passedTests}</strong>
                      </div>
                      <div className="p-2 rounded bg-surface">
                        <span className="text-text-muted block">Failed</span>
                        <strong className="text-rose-400 font-bold">{th.failedTests}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Section 3: Enterprise Team / POD Browser */}
      {showTeams && (
        <Card
          title="Enterprise Agile Teams & POD Browser"
          subtitle="Live search and metadata inspection across enterprise agile teams"
          actions={
            <Badge variant="neutral">
              {teams.length} {teams.length === 1 ? 'POD' : 'PODs'}
            </Badge>
          }
        >
          {/* Search Bar */}
          <div className="mb-4">
            <input
              type="text"
              aria-label="Search enterprise PODs"
              placeholder="Search by POD name, module (e.g. EMI, Loan), or leader name..."
              value={teamSearchQuery}
              onChange={(e) => setTeamSearchQuery(e.target.value)}
              className="w-full bg-surface border border-border rounded px-4 py-2 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]"
            />
          </div>

          {isLoading && teams.length === 0 ? (
            <Skeleton count={3} />
          ) : teams.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">
              No enterprise PODs match your search query.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {teams.map((t: AzureTeamSummary) => {
                const parsed = parseTeamDescription(t.description);

                return (
                  <div
                    key={t.teamId}
                    className="p-4 rounded-lg bg-surface border border-border flex flex-col justify-between hover:border-accent transition-colors gap-2 min-w-0"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-bold text-text line-clamp-1">{t.name}</h4>
                        <Badge variant="neutral" className="flex-shrink-0">
                          {t.projectName === '3in1_Agile_Projects' ? 'Agile' : 'AppFrontEnd'}
                        </Badge>
                      </div>

                      {parsed && (
                        <div className="space-y-1.5 mt-2">
                          {parsed['POD Size'] && (
                            <Badge variant="success">Size: {parsed['POD Size']} members</Badge>
                          )}
                          {parsed['Modules'] && (
                            <p className="text-xs text-text-muted mt-1 break-words">
                              <strong className="text-text">Modules:</strong> {parsed['Modules']}
                            </p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-2 mt-2 border-t border-border text-xs min-w-0">
                            {parsed['LP'] && (
                              <div className="min-w-0 break-words">
                                <span className="text-text-muted">LP: </span>
                                <span className="font-medium text-text">{parsed['LP']}</span>
                              </div>
                            )}
                            {parsed['TA'] && (
                              <div className="min-w-0 break-words">
                                <span className="text-text-muted">TA: </span>
                                <span className="font-medium text-text">{parsed['TA']}</span>
                              </div>
                            )}
                            {parsed['SDM'] && (
                              <div className="min-w-0 break-words">
                                <span className="text-text-muted">SDM: </span>
                                <span className="font-medium text-text">{parsed['SDM']}</span>
                              </div>
                            )}
                            {parsed['QL'] && (
                              <div className="min-w-0 break-words">
                                <span className="text-text-muted">QL: </span>
                                <span className="font-medium text-text">{parsed['QL']}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {!parsed && t.description && (
                        <p className="text-xs text-text-muted mt-2 line-clamp-2">
                          {t.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Section 4: Unassigned Tasks & Backlog Discovery */}
      {showUnassigned && (
        <UnassignedTaskManager
          workItems={unassignedWorkItems}
          totalCount={unassignedCount}
          isLoading={isLoading}
          selectedProjectId={selectedProjectId}
          onSelectProject={(pId) => {
            setSelectedProjectId(pId);
            fetchUnassignedWorkItems(pId);
          }}
          onRefresh={() => fetchUnassignedWorkItems(selectedProjectId)}
        />
      )}
    </div>
  );
}
