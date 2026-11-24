#!/usr/bin/env node

/**
 * Best-effort, read-only export of Azure DevOps data visible to a PAT.
 * The token is never written to disk or printed.
 *
 * Usage:
 *   AZURE_DEVOPS_PAT=... AZURE_DEVOPS_ORG=... node scripts/export-azure-readable-data.mjs
 *   node --env-file=.env scripts/export-azure-readable-data.mjs --project 3in1_Agile_Projects
 *
 * The output is JSON in data.txt (one JSON document). Azure APIs require
 * different PAT scopes; inaccessible endpoints are recorded under errors.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { parseArguments, modeAllows } from './azure-export/config.mjs';
import { classifyError } from './azure-export/errors.mjs';
import { SqliteExportWriter } from './azure-export/sqlite-writer.mjs';

const args = process.argv.slice(2);
const argument = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1].trim() : fallback;
};
const outputPath = path.resolve(argument('output', process.env.AZURE_EXPORT_OUTPUT || 'azure-data.db'));
const organization = argument('org', process.env.AZURE_DEVOPS_ORG || 'BFLDevOpsOrg').trim();
const defaultProjects = '3_in_1_AppFrontEnd_Tasks,3in1_Agile_Projects';
const selectedProject = argument('projects', argument('project', process.env.AZURE_EXPORT_PROJECTS || defaultProjects)).trim();
const selectedProjects = selectedProject
  .split(',')
  .map(project => project.trim())
  .filter(Boolean);
const selectedProjectKeys = new Set(selectedProjects.map(project => project.toLowerCase()));
const pat = process.env.AZURE_DEVOPS_PAT?.trim() || '';
const delayMs = Number.parseInt(process.env.AZURE_EXPORT_DELAY_MS || '40', 10);
const maxPages = Number.parseInt(process.env.AZURE_EXPORT_MAX_PAGES || '100000', 10);
const maxWorkItems = Number.parseInt(process.env.AZURE_EXPORT_MAX_WORK_ITEMS || '1000000', 10);
const maxChildren = Number.parseInt(process.env.AZURE_EXPORT_MAX_CHILDREN || '1000000', 10);
const apiVersion = '7.0';

function safeSegment(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return encodeURIComponent(value);
}

const orgPath = safeSegment(organization, 'organization');
const devRoot = `https://dev.azure.com/${orgPath}`;
const vsrmRoot = `https://vsrm.dev.azure.com/${orgPath}`;
const vsspsRoot = `https://vssps.dev.azure.com/${orgPath}`;
const authorization = `Basic ${Buffer.from(`:${pat}`, 'utf8').toString('base64')}`;

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeMessage(text) {
  return String(text || '')
    .replaceAll(pat, '[REDACTED]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
    .slice(0, 1000);
}

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'error',
        signal: options.signal || AbortSignal.timeout(120_000),
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
      const bodyText = await response.text();
      let body = null;
      if (bodyText) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }
      if (!response.ok) {
        const error = new Error(`Azure DevOps returned HTTP ${response.status}`);
        error.status = response.status;
        error.response = sanitizeMessage(bodyText);
        error.url = new URL(url).origin + new URL(url).pathname;
        error.retryAfter = response.headers.get('retry-after') || '';
        throw error;
      }
      return {
        body,
        continuationToken: response.headers.get('x-ms-continuationtoken') || '',
      };
    } catch (error) {
      lastError = error;
      const status = Number(error.status || 0);
      const retryableStatus = status === 429 || status >= 500;
      const retryAfterSeconds = Number(error.retryAfter || 0);
      if ((!retryableStatus && status > 0) || attempt === 10) break;
      const delay = retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 30_000)
        : Math.min(attempt * 500 * (1 + Math.random() * 0.25), 10_000);
      await pause(delay);
    }
  }
  throw lastError;
}

export async function exportReadableAzureData(options = {}) {
  const document = options.document || {
    formatVersion: 3,
    generatedAt: new Date().toISOString(),
    organization,
    requestedProject: selectedProject || null,
    requestedProjects: selectedProjects,
    output: outputPath,
    data: {},
    errors: [],
  };

  if (!pat) {
    throw new Error('AZURE_DEVOPS_PAT is required. Supply it via the environment or node --env-file=.env.');
  }

  const config = parseArguments(process.argv.slice(2));
  const writer = new SqliteExportWriter(outputPath, {
    runId: randomUUID(),
    mode: config.mode,
    projects: selectedProjects,
    organization,
  });
  if (config.resumeRunId) {
    if (fs.existsSync(outputPath)) {
      const previous = new DatabaseSync(outputPath, { readOnly: true });
      try {
        const cursors = previous.prepare('SELECT project_name, resource_type, cursor, updated_at FROM sync_cursors WHERE run_id=?').all(config.resumeRunId);
        writer.importCursors(cursors);
        writer.setMeta('resumedFromRunId', config.resumeRunId);
      } finally {
        previous.close();
      }
    }
  }

  const abortWriter = signal => {
    writer.abort();
    console.error(`[export] interrupted by ${signal}; staging database removed`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => abortWriter('SIGINT'));
  process.once('SIGTERM', () => abortWriter('SIGTERM'));

  const addError = (scope, error) => {
    const cause = error?.cause;
    const row = {
      scope,
      status: error?.status || null,
      category: classifyError(error),
      message: sanitizeMessage(error?.message),
      cause: sanitizeMessage(cause?.code || cause?.message || ''),
      response: sanitizeMessage(error?.response),
      url: error?.url || null,
    };
    document.errors.push(row);
    writer.saveError(row);
  };

  const persist = (scope, payload) => {
    const projectMatch = /^project\.([^.]+)\./.exec(scope);
    writer.saveDataset(scope, projectMatch?.[1] || 'organization', payload);
  };
  const writeCheckpoint = () => {
    writer.setMeta('datasetCount', String(writer.database.prepare('SELECT COUNT(*) AS count FROM datasets').get().count));
    writer.setMeta('errorCount', String(document.errors.length));
  };

  console.log(`[export] staging database: ${writer.stagingPath}`);

  const collect = async (scope, url, options = {}) => {
    const feature = options.feature || 'all';
    if (feature !== 'all' && !modeAllows(config, feature)) {
      writer.saveStep(scope, 'skipped', 0, 0, `${feature} excluded by ${config.mode} mode`);
      return null;
    }
    const startedAt = Date.now();
    try {
      if (!options.paged) {
        const result = await request(url, options.request || {});
        persist(scope, result.body);
        writer.saveStep(scope, 'complete', 0, Date.now() - startedAt);
        console.log(`[export] ${scope}`);
        return result.body;
      }

      const values = [];
      let continuationToken = '';
      let pages = 0;
      do {
        const pageUrl = new URL(url);
        if (continuationToken) pageUrl.searchParams.set('continuationToken', continuationToken);
        const result = await request(pageUrl.toString());
        const value = Array.isArray(result.body?.value) ? result.body.value : [];
        values.push(...value);
        continuationToken = result.continuationToken;
        pages += 1;
        writer.saveCursor('shared', scope, continuationToken);
        if (delayMs > 0) await pause(delayMs);
        if (pages >= maxPages) {
          addError(scope, new Error(`Pagination stopped at configured maximum of ${maxPages} pages.`));
          break;
        }
      } while (continuationToken);

      persist(scope, { count: values.length, value: values });
      writer.saveStep(scope, 'complete', values.length, Date.now() - startedAt);
      console.log(`[export] ${scope}: ${values.length} records`);
      return values;
    } catch (error) {
      addError(scope, error);
      writer.saveStep(scope, 'partial', 0, Date.now() - startedAt, error?.message || '');
      console.warn(`[export] ${scope}: HTTP ${error?.status || 'network/scope error'}`);
      return null;
    }
  };

  await collect('account.connectionData', `${devRoot}/_apis/connectionData?api-version=${apiVersion}-preview.1`);
  await collect('organization.identities', `${vsspsRoot}/_apis/identities?api-version=${apiVersion}`, { paged: true });
  const projects = await collect('organization.projects', `${devRoot}/_apis/projects?$top=1000&stateFilter=all&api-version=${apiVersion}`, { paged: true });
  writeCheckpoint();

  const projectList = Array.isArray(projects)
    ? projects.filter(project => selectedProjectKeys.has(String(project.name || '').toLowerCase()) || selectedProjectKeys.has(String(project.id || '').toLowerCase()))
    : selectedProjects.map(projectName => ({ id: projectName, name: projectName }));

  for (const project of projectList) {
    const projectId = encodeURIComponent(project.id || project.name);
    const projectRoot = `${devRoot}/${projectId}`;
    const projectKey = String(project.name || project.id).replace(/[^A-Za-z0-9._-]/g, '_');

    await collect(`project.${projectKey}.details`, `${devRoot}/_apis/projects/${projectId}?includeCapabilities=true&includeHistory=true&api-version=${apiVersion}`);
    await collect(`project.${projectKey}.properties`, `${devRoot}/_apis/projects/${projectId}/properties?api-version=${apiVersion}-preview.1`, { paged: true });
    await collect(`project.${projectKey}.policyTypes`, `${projectRoot}/_apis/policy/types?api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.policyConfigurations`, `${projectRoot}/_apis/policy/configurations?includeAllPolicies=true&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.agentQueues`, `${projectRoot}/_apis/distributedtask/queues?$top=1000&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.serviceHooksSubscriptions`, `${devRoot}/_apis/hooks/subscriptions?consumerId=&publisherId=&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.notificationSubscriptions`, `${devRoot}/_apis/notification/subscriptions?api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.processConfiguration`, `${projectRoot}/_apis/work/processconfiguration?api-version=${apiVersion}`);
    await collect(`project.${projectKey}.teamFieldValues`, `${projectRoot}/_apis/work/teamsettings/teamfieldvalues?api-version=${apiVersion}`);
    const teams = await collect(`project.${projectKey}.teams`, `${devRoot}/_apis/projects/${projectId}/teams?$top=1000&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.iterations`, `${projectRoot}/_apis/wit/classificationnodes/iterations?$depth=100&api-version=${apiVersion}`);
    await collect(`project.${projectKey}.areas`, `${projectRoot}/_apis/wit/classificationnodes/areas?$depth=100&api-version=${apiVersion}`);
    await collect(`project.${projectKey}.tags`, `${projectRoot}/_apis/wit/tags?$top=1000&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.fields`, `${projectRoot}/_apis/wit/fields?$top=1000&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.queries`, `${projectRoot}/_apis/wit/queries?$depth=20&$expand=all&api-version=${apiVersion}`);

    for (const team of (teams || []).slice(0, maxChildren)) {
      const teamId = encodeURIComponent(team.id || team.name);
      const teamKey = String(team.name || team.id).replace(/[^A-Za-z0-9._-]/g, '_');
      const teamRoot = `${projectRoot}/${teamId}`;
      await collect(`project.${projectKey}.team.${teamKey}.members`, `${devRoot}/_apis/projects/${projectId}/teams/${teamId}/members?$top=1000&api-version=${apiVersion}`, { paged: true });
      const iterations = await collect(`project.${projectKey}.team.${teamKey}.iterations`, `${teamRoot}/_apis/work/teamsettings/iterations?$timeframe=currentAndFuture&api-version=${apiVersion}`, { paged: true });
      await collect(`project.${projectKey}.team.${teamKey}.settings`, `${teamRoot}/_apis/work/teamsettings?api-version=${apiVersion}`);
      await collect(`project.${projectKey}.team.${teamKey}.backlogConfiguration`, `${teamRoot}/_apis/work/backlogs?api-version=${apiVersion}`);
      const boards = await collect(`project.${projectKey}.team.${teamKey}.boards`, `${teamRoot}/_apis/work/boards?api-version=${apiVersion}`, { paged: true });
      for (const board of boards || []) {
        const boardId = encodeURIComponent(board.id || board.name);
        const boardKey = String(board.name || board.id).replace(/[^A-Za-z0-9._-]/g, '_');
        await collect(`project.${projectKey}.team.${teamKey}.board.${boardKey}.columns`, `${teamRoot}/_apis/work/boards/${boardId}/columns?api-version=${apiVersion}`);
        await collect(`project.${projectKey}.team.${teamKey}.board.${boardKey}.rows`, `${teamRoot}/_apis/work/boards/${boardId}/rows?api-version=${apiVersion}`);
        await collect(`project.${projectKey}.team.${teamKey}.board.${boardKey}.charts`, `${teamRoot}/_apis/work/boards/${boardId}/charts?api-version=${apiVersion}`);
      }
      for (const iteration of iterations || []) {
        const iterationId = encodeURIComponent(iteration.id);
        await collect(`project.${projectKey}.team.${teamKey}.iteration.${iteration.id}.capacities`, `${teamRoot}/_apis/work/teamsettings/iterations/${iterationId}/capacities?api-version=${apiVersion}`);
        await collect(`project.${projectKey}.team.${teamKey}.iteration.${iteration.id}.daysOff`, `${teamRoot}/_apis/work/teamsettings/iterations/${iterationId}/teamdaysoff?api-version=${apiVersion}`);
      }
      const dashboards = await collect(`project.${projectKey}.team.${teamKey}.dashboards`, `${teamRoot}/_apis/dashboard/dashboards?api-version=${apiVersion}-preview.2`, { paged: true });
      for (const dashboard of dashboards || []) {
        const dashboardId = encodeURIComponent(dashboard.id);
        const dashboardScope = `project.${projectKey}.team.${teamKey}.dashboard.${dashboard.id}`;
        const dashboardDetails = await collect(dashboardScope, `${teamRoot}/_apis/dashboard/dashboards/${dashboardId}?api-version=${apiVersion}-preview.2`);
        for (const widget of dashboardDetails?.widgets || []) {
          await collect(`${dashboardScope}.widget.${widget.id}`, `${teamRoot}/_apis/dashboard/dashboards/${dashboardId}/widgets/${encodeURIComponent(widget.id)}?api-version=${apiVersion}-preview.2`);
        }
      }
    }

    const repositories = await collect(`project.${projectKey}.repositories`, `${projectRoot}/_apis/git/repositories?includeLinks=true&includeAllUrls=true&api-version=${apiVersion}`, { paged: true });
    for (const repository of repositories || []) {
      const repositoryId = encodeURIComponent(repository.id || repository.name);
      const repositoryKey = String(repository.name || repository.id).replace(/[^A-Za-z0-9._-]/g, '_');
      const repositoryRoot = `${projectRoot}/_apis/git/repositories/${repositoryId}`;
      await collect(`project.${projectKey}.repository.${repositoryKey}.details`, `${projectRoot}/_apis/git/repositories/${repositoryId}?includeLinks=true&includeAllUrls=true&api-version=${apiVersion}`);
      await collect(`project.${projectKey}.repository.${repositoryKey}.stats`, `${repositoryRoot}/stats?api-version=${apiVersion}`, { paged: true });
      await collect(`project.${projectKey}.repository.${repositoryKey}.policyConfigurations`, `${projectRoot}/_apis/git/policy/configurations?repositoryId=${encodeURIComponent(repository.id)}&api-version=${apiVersion}`, { paged: true });
      const refs = await collect(`project.${projectKey}.repository.${repositoryKey}.refs`, `${repositoryRoot}/refs?$top=1000&api-version=${apiVersion}`, { paged: true });
      for (const ref of (refs || []).slice(0, maxChildren)) {
        const refKey = String(ref.name || 'unknown').replace(/^refs\//, '').replace(/[^A-Za-z0-9._-]/g, '_');
        const versionType = ref.name?.startsWith('refs/tags/') ? 'tag' : 'branch';
        const itemVersion = ref.name?.startsWith('refs/heads/')
          ? ref.name.slice('refs/heads/'.length)
          : ref.name?.startsWith('refs/tags/')
            ? ref.name.slice('refs/tags/'.length)
            : ref.name || '';
        await collect(
          `project.${projectKey}.repository.${repositoryKey}.commits.${refKey}`,
          `${repositoryRoot}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(itemVersion)}&searchCriteria.itemVersion.versionType=${versionType}&searchCriteria.$top=1000&api-version=${apiVersion}`,
          { paged: true, feature: 'commits' },
        );
      }
      const pullRequests = await collect(`project.${projectKey}.repository.${repositoryKey}.pullRequests`, `${repositoryRoot}/pullrequests?searchCriteria.status=all&$top=1000&api-version=${apiVersion}`, { paged: true });
      for (const pullRequest of (pullRequests || []).slice(0, maxChildren)) {
        const prId = encodeURIComponent(pullRequest.pullRequestId);
        const prScope = `project.${projectKey}.repository.${repositoryKey}.pullRequest.${pullRequest.pullRequestId}`;
        await collect(`${prScope}.details`, `${repositoryRoot}/pullrequests/${prId}?api-version=${apiVersion}`);
        await collect(`${prScope}.threads`, `${repositoryRoot}/pullrequests/${prId}/threads?api-version=${apiVersion}`, { paged: true });
        await collect(`${prScope}.reviewers`, `${repositoryRoot}/pullrequests/${prId}/reviewers?api-version=${apiVersion}`, { paged: true });
        await collect(`${prScope}.iterations`, `${repositoryRoot}/pullrequests/${prId}/iterations?api-version=${apiVersion}`, { paged: true });
        await collect(`${prScope}.commits`, `${repositoryRoot}/pullrequests/${prId}/commits?api-version=${apiVersion}`, { paged: true, feature: 'commits' });
        await collect(`${prScope}.workItems`, `${repositoryRoot}/pullrequests/${prId}/workitems?api-version=${apiVersion}`, { paged: true });
        await collect(`${prScope}.statuses`, `${repositoryRoot}/pullrequests/${prId}/statuses?api-version=${apiVersion}`, { paged: true });
        await collect(`${prScope}.attachments`, `${repositoryRoot}/pullrequests/${prId}/attachments?api-version=${apiVersion}`, { paged: true, feature: 'attachments' });
        await collect(`${prScope}.labels`, `${repositoryRoot}/pullrequests/${prId}/labels?api-version=${apiVersion}`, { paged: true });
      }
    }

    const wiqlUrl = `${projectRoot}/_apis/wit/wiql?api-version=${apiVersion}`;
    let workItemRefs = [];
    try {
      const escapedProjectName = String(project.name || project.id).replaceAll("'", "''");
      const pendingRanges = [{ start: 0, end: 1_000_000_000 }];
      let completedRanges = 0;
      while (pendingRanges.length && workItemRefs.length < maxWorkItems) {
        const range = pendingRanges.pop();
        const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escapedProjectName}' AND [System.Id] >= ${range.start} AND [System.Id] < ${range.end} ORDER BY [System.Id] ASC`;
        try {
          const wiql = await request(wiqlUrl, { method: 'POST', body: JSON.stringify({ query }) });
          workItemRefs.push(...(wiql.body?.workItems || []));
          completedRanges += 1;
        } catch (error) {
          if (error.status === 400 && /VS402337|exceeds the size limit of 20000/i.test(error.response) && range.end - range.start > 1) {
            const midpoint = range.start + Math.floor((range.end - range.start) / 2);
            pendingRanges.push({ start: midpoint, end: range.end });
            pendingRanges.push({ start: range.start, end: midpoint });
          } else throw error;
        }
        if (completedRanges > maxPages) throw new Error(`Work item ID-range paging stopped at configured maximum of ${maxPages} queries.`);
      }
      workItemRefs.sort((a, b) => a.id - b.id);
      const truncated = workItemRefs.length > maxWorkItems || pendingRanges.length > 0;
      workItemRefs = workItemRefs.slice(0, maxWorkItems);
      document.data[`project.${projectKey}.workItemRefs`] = { completedRanges, exported: workItemRefs.length, truncated, value: workItemRefs };
      persist(`project.${projectKey}.workItemRefs`, document.data[`project.${projectKey}.workItemRefs`]);
    } catch (error) {
      addError(`project.${projectKey}.workItemRefs`, error);
    }

    const workItems = [];
    for (let offset = 0; offset < workItemRefs.length; offset += 200) {
      const ids = workItemRefs.slice(offset, offset + 200).map(item => item.id).join(',');
      try {
        const batch = await request(`${projectRoot}/_apis/wit/workitems?ids=${ids}&$expand=all&errorPolicy=omit&api-version=${apiVersion}`);
        const expectedIds = ids.split(',').map(Number);
        const returned = batch.body?.value || [];
        const returnedIds = new Set(returned.map(item => Number(item.id)));
        const missingIds = expectedIds.filter(id => !returnedIds.has(id));
        if (returned.length !== expectedIds.length || missingIds.length > 0) {
          throw new Error(`Incomplete Azure work-item batch; missing IDs: ${missingIds.join(',')}`);
        }
        workItems.push(...returned);
      } catch (error) {
        addError(`project.${projectKey}.workItems.batch.${offset}`, error);
      }
      if (delayMs > 0) await pause(delayMs);
    }
    document.data[`project.${projectKey}.workItems`] = { count: workItems.length, value: workItems };
    persist(`project.${projectKey}.workItems`, document.data[`project.${projectKey}.workItems`]);
    for (const item of workItems) {
      const itemId = item.id;
      const workItemScope = `project.${projectKey}.workItem.${itemId}`;
      await collect(`${workItemScope}.updates`, `${projectRoot}/_apis/wit/workItems/${itemId}/updates?$top=1000&api-version=${apiVersion}`, { paged: true });
      await collect(`${workItemScope}.revisions`, `${projectRoot}/_apis/wit/workItems/${itemId}/revisions?$top=1000&$expand=all&api-version=${apiVersion}`, { paged: true, feature: 'revisions' });
      await collect(`${workItemScope}.comments`, `${projectRoot}/_apis/wit/workItems/${itemId}/comments?$top=1000&order=asc&api-version=${apiVersion}-preview.4`, { paged: true, feature: 'comments' });
      const relations = Array.isArray(item.relations) ? item.relations : [];
      for (const relation of relations) {
        if (!relation.url) continue;
        if (relation.url.includes('/_apis/wit/attachments/')) {
          const attachmentId = encodeURIComponent(relation.url.split('/').pop().split('?')[0]);
          const attachmentScope = `${workItemScope}.attachment.${String(relation.attributes?.name || attachmentId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
          await collect(`${attachmentScope}.metadata`, `${projectRoot}/_apis/wit/attachments/${attachmentId}?api-version=${apiVersion}`, { feature: 'attachments' });
        }
      }
      if (delayMs > 0) await pause(delayMs);
    }
    writeCheckpoint();

    const workItemTypes = await collect(`project.${projectKey}.workItemTypes`, `${projectRoot}/_apis/wit/workitemtypes?$top=1000&api-version=${apiVersion}`, { paged: true });
    for (const workItemType of workItemTypes || []) {
      const typeName = encodeURIComponent(workItemType.name);
      const typeKey = String(workItemType.name).replace(/[^A-Za-z0-9._-]/g, '_');
      await collect(`project.${projectKey}.workItemType.${typeKey}.fields`, `${projectRoot}/_apis/wit/workitemtypes/${typeName}/fields?$top=1000&api-version=${apiVersion}`, { paged: true });
      await collect(`project.${projectKey}.workItemType.${typeKey}.states`, `${projectRoot}/_apis/wit/workitemtypes/${typeName}/states?api-version=${apiVersion}`, { paged: true });
    }
    await collect(`project.${projectKey}.fields`, `${projectRoot}/_apis/wit/fields?$top=1000&api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.queries`, `${projectRoot}/_apis/wit/queries?$depth=20&$expand=all&api-version=${apiVersion}`);
    await collect(`project.${projectKey}.iterations`, `${projectRoot}/_apis/wit/classificationnodes/iterations?$depth=100&api-version=${apiVersion}`);
    await collect(`project.${projectKey}.areas`, `${projectRoot}/_apis/wit/classificationnodes/areas?$depth=100&api-version=${apiVersion}`);
    await collect(`project.${projectKey}.tags`, `${projectRoot}/_apis/wit/tags?$top=1000&api-version=${apiVersion}`, { paged: true });

    const pipelines = await collect(`project.${projectKey}.pipelines`, `${projectRoot}/_apis/pipelines?$top=1000&api-version=${apiVersion}`, { paged: true });
    for (const pipeline of pipelines || []) {
      const pipelineId = encodeURIComponent(pipeline.id);
      await collect(`project.${projectKey}.pipeline.${pipeline.id}.details`, `${projectRoot}/_apis/pipelines/${pipelineId}?api-version=${apiVersion}`);
      await collect(`project.${projectKey}.pipeline.${pipeline.id}.preview`, `${projectRoot}/_apis/pipelines/${pipelineId}/preview?api-version=${apiVersion}`, { request: { method: 'POST', body: JSON.stringify({ previewRun: true }) }, feature: 'preview' });
      const runs = await collect(`project.${projectKey}.pipeline.${pipeline.id}.runs`, `${projectRoot}/_apis/pipelines/${pipelineId}/runs?$top=1000&api-version=${apiVersion}`, { paged: true });
      for (const run of (runs || []).slice(0, maxChildren)) {
        const runId = encodeURIComponent(run.id);
        const runScope = `project.${projectKey}.pipeline.${pipeline.id}.run.${run.id}`;
        await collect(`${runScope}.details`, `${projectRoot}/_apis/pipelines/${pipelineId}/runs/${runId}?api-version=${apiVersion}`);
        const logs = await collect(`${runScope}.logs`, `${projectRoot}/_apis/pipelines/${pipelineId}/runs/${runId}/logs?api-version=${apiVersion}`, { paged: true, feature: 'logs' });
        for (const log of (logs || []).slice(0, maxChildren)) {
          await collect(`${runScope}.log.${log.id}.content`, `${projectRoot}/_apis/pipelines/${pipelineId}/runs/${runId}/logs/${encodeURIComponent(log.id)}?api-version=${apiVersion}`, { feature: 'logs' });
        }
        await collect(`${runScope}.artifacts`, `${projectRoot}/_apis/pipelines/${pipelineId}/runs/${runId}/artifacts?api-version=${apiVersion}`, { paged: true });
      }
    }

    const builds = await collect(`project.${projectKey}.builds`, `${projectRoot}/_apis/build/builds?$top=1000&queryOrder=finishTimeDescending&api-version=${apiVersion}`, { paged: true });
    const buildDefinitions = await collect(`project.${projectKey}.buildDefinitions`, `${projectRoot}/_apis/build/definitions?includeAllProperties=true&api-version=${apiVersion}`, { paged: true });
    for (const definition of buildDefinitions || []) {
      await collect(`project.${projectKey}.buildDefinition.${definition.id}.details`, `${projectRoot}/_apis/build/definitions/${encodeURIComponent(definition.id)}?includeAllProperties=true&api-version=${apiVersion}`);
    }
    for (const build of (builds || []).slice(0, maxChildren)) {
      const buildId = encodeURIComponent(build.id);
      const buildScope = `project.${projectKey}.build.${build.id}`;
      await collect(`${buildScope}.details`, `${projectRoot}/_apis/build/builds/${buildId}?api-version=${apiVersion}`);
      await collect(`${buildScope}.properties`, `${projectRoot}/_apis/build/builds/${buildId}/properties?api-version=${apiVersion}`, { paged: true });
      await collect(`${buildScope}.tags`, `${projectRoot}/_apis/build/builds/${buildId}/tags?api-version=${apiVersion}`, { paged: true });
      await collect(`${buildScope}.timeline`, `${projectRoot}/_apis/build/builds/${buildId}/timeline?api-version=${apiVersion}`);
      await collect(`${buildScope}.logs`, `${projectRoot}/_apis/build/builds/${buildId}/logs?api-version=${apiVersion}`, { paged: true, feature: 'logs' });
      await collect(`${buildScope}.artifacts`, `${projectRoot}/_apis/build/builds/${buildId}/artifacts?api-version=${apiVersion}`, { paged: true });
      await collect(`${buildScope}.changes`, `${projectRoot}/_apis/build/builds/${buildId}/changes?$top=1000&api-version=${apiVersion}`, { paged: true });
      await collect(`${buildScope}.workItems`, `${projectRoot}/_apis/build/builds/${buildId}/workitems?$top=1000&api-version=${apiVersion}`, { paged: true });
    }

    const releaseDefinitions = await collect(`project.${projectKey}.releaseDefinitions`, `${vsrmRoot}/${projectId}/_apis/release/definitions?$top=1000&api-version=${apiVersion}`, { paged: true });
    for (const definition of releaseDefinitions || []) {
      await collect(`project.${projectKey}.releaseDefinition.${definition.id}.details`, `${vsrmRoot}/${projectId}/_apis/release/definitions/${encodeURIComponent(definition.id)}?api-version=${apiVersion}`);
    }
    const releases = await collect(`project.${projectKey}.releases`, `${vsrmRoot}/${projectId}/_apis/release/releases?$top=1000&api-version=${apiVersion}`, { paged: true });
    for (const release of (releases || []).slice(0, maxChildren)) {
      const releaseId = encodeURIComponent(release.id);
      await collect(`project.${projectKey}.release.${release.id}.details`, `${vsrmRoot}/${projectId}/_apis/release/releases/${releaseId}?api-version=${apiVersion}`);
      await collect(`project.${projectKey}.release.${release.id}.logs`, `${vsrmRoot}/${projectId}/_apis/release/releases/${releaseId}/logs?api-version=${apiVersion}`, { paged: true, feature: 'logs' });
      await collect(`project.${projectKey}.release.${release.id}.approvals`, `${vsrmRoot}/${projectId}/_apis/release/approvals?releaseIdsFilter=${releaseId}&api-version=${apiVersion}`, { paged: true });
    }

    const testPlans = await collect(`project.${projectKey}.testPlans`, `${projectRoot}/_apis/testplan/plans?$top=1000&api-version=${apiVersion}`, { paged: true });
    for (const plan of (testPlans || []).slice(0, maxChildren)) {
      const planId = encodeURIComponent(plan.id);
      const suites = await collect(`project.${projectKey}.testPlan.${plan.id}.suites`, `${projectRoot}/_apis/testplan/Plans/${planId}/suites?asTree=false&$top=1000&api-version=${apiVersion}`, { paged: true });
      const configurations = await collect(`project.${projectKey}.testPlan.${plan.id}.configurations`, `${projectRoot}/_apis/testplan/Plans/${planId}/configurations?api-version=${apiVersion}`, { paged: true });
      await collect(`project.${projectKey}.testPlan.${plan.id}.details`, `${projectRoot}/_apis/testplan/plans/${planId}?api-version=${apiVersion}`);
      for (const suite of (suites || []).slice(0, maxChildren)) {
        await collect(`project.${projectKey}.testPlan.${plan.id}.suite.${suite.id}.testCases`, `${projectRoot}/_apis/testplan/Plans/${planId}/Suites/${encodeURIComponent(suite.id)}/TestCase?$top=1000&api-version=${apiVersion}`, { paged: true });
      }
      for (const configuration of (configurations || []).slice(0, maxChildren)) {
        await collect(`project.${projectKey}.testPlan.${plan.id}.configuration.${configuration.id}`, `${projectRoot}/_apis/testplan/configurations/${encodeURIComponent(configuration.id)}?api-version=${apiVersion}`);
      }
    }

    const testRuns = await collect(`project.${projectKey}.testRuns`, `${projectRoot}/_apis/test/runs?$top=1000&api-version=${apiVersion}`, { paged: true });
    for (const testRun of (testRuns || []).slice(0, maxChildren)) {
      const runId = encodeURIComponent(testRun.id);
      const testResults = await collect(`project.${projectKey}.testRun.${testRun.id}.results`, `${projectRoot}/_apis/test/Runs/${runId}/results?$top=1000&api-version=${apiVersion}`, { paged: true });
      for (const testResult of (testResults || []).slice(0, maxChildren)) {
        await collect(`project.${projectKey}.testRun.${testRun.id}.result.${testResult.id}.attachments`, `${projectRoot}/_apis/test/Runs/${runId}/Results/${encodeURIComponent(testResult.id)}/attachments?api-version=${apiVersion}`, { paged: true });
      }
    }

    const wikis = await collect(`project.${projectKey}.wikis`, `${projectRoot}/_apis/wiki/wikis?api-version=${apiVersion}`, { paged: true });
    for (const wiki of wikis || []) {
      const wikiId = encodeURIComponent(wiki.id);
      await collect(`project.${projectKey}.wiki.${wiki.id}.pages`, `${projectRoot}/_apis/wiki/wikis/${wikiId}/pages?path=/&recursionLevel=full&includeContent=true&api-version=${apiVersion}`);
    }

    const serviceEndpoints = await collect(`project.${projectKey}.serviceEndpoints`, `${projectRoot}/_apis/serviceendpoint/endpoints?includeDetails=true&api-version=${apiVersion}`, { paged: true });
    for (const endpoint of serviceEndpoints || []) {
      await collect(`project.${projectKey}.serviceEndpoint.${endpoint.id}.details`, `${projectRoot}/_apis/serviceendpoint/endpoints/${encodeURIComponent(endpoint.id)}?includeDetails=true&api-version=${apiVersion}`);
    }
    await collect(`project.${projectKey}.variableGroups`, `${projectRoot}/_apis/distributedtask/variablegroups?api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.taskGroups`, `${projectRoot}/_apis/distributedtask/taskgroups?api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.environments`, `${projectRoot}/_apis/distributedtask/environments?api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.deploymentGroups`, `${projectRoot}/_apis/distributedtask/deploymentgroups?api-version=${apiVersion}`, { paged: true });
    await collect(`project.${projectKey}.feeds`, `${projectRoot}/_apis/packaging/feeds?includeUrls=true&api-version=${apiVersion}`, { paged: true });
    writeCheckpoint();

    const projectPrefix = `project.${projectKey}.`;
    const projectDataKeys = Object.keys(document.data).filter(key => key.startsWith(projectPrefix));
    const projectErrorRows = document.errors.filter(row => row.scope.startsWith(projectPrefix));
    document.data[`project.${projectKey}.dashboardSummary`] = {
      projectId: String(project.id || ''),
      projectName: String(project.name || project.id || ''),
      generatedAt: new Date().toISOString(),
      datasetCount: projectDataKeys.length,
      errorCount: projectErrorRows.length,
      counts: {
        teams: teams?.length || 0,
        repositories: repositories?.length || 0,
        workItems: workItems.length,
        workItemRefs: workItemRefs.length,
        pipelines: pipelines?.length || 0,
        builds: builds?.length || 0,
        buildDefinitions: buildDefinitions?.length || 0,
        releases: releases?.length || 0,
        releaseDefinitions: releaseDefinitions?.length || 0,
        testPlans: testPlans?.length || 0,
        testRuns: testRuns?.length || 0,
        wikis: wikis?.length || 0,
        serviceEndpoints: serviceEndpoints?.length || 0,
      },
      datasetKeys: projectDataKeys,
      incompleteScopes: projectErrorRows.map(row => ({ scope: row.scope, status: row.status, message: row.message })),
    };
    document.projectSummaries ||= {};
    document.projectSummaries[projectKey] = document.data[`project.${projectKey}.dashboardSummary`];
    persist(`project.${projectKey}.dashboardSummary`, document.data[`project.${projectKey}.dashboardSummary`]);
    writer.setMeta('projectSummaries', JSON.stringify(document.projectSummaries));
    writeCheckpoint();
  }

  document.completedProjectNames = projectList.map(project => project.name || project.id);
  document.completedAt = new Date().toISOString();
  document.errorCount = document.errors.length;
  writer.setMeta('completedProjectNames', JSON.stringify(document.completedProjectNames));
  const status = projectList.length === selectedProjects.length && document.errors.length === 0 ? 'complete' : 'partial';
  const result = writer.publish(status);
  return { ...document, exportResult: result };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = await exportReadableAzureData();
    console.log(`Exported readable Azure DevOps data to ${outputPath}`);
    console.log(`Datasets: ${result.exportResult.datasetCount}; API errors/partial scopes: ${result.errors.length}`);
  } catch (error) {
    console.error(`Export failed: ${sanitizeMessage(error.message)}`);
    process.exitCode = 1;
  }
}
