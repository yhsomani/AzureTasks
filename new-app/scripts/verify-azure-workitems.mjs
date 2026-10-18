#!/usr/bin/env node
/**
 * Issue #11: verify observed per-member task series against *real* work items.
 * Bounded read-only Azure WIQL POST (query only) and GET work-item calls.
 * Never creates, patches, closes or repairs an Azure work item.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectConfiguredMembers } from './verify-azure-identities.mjs';

const MAX_ITEMS_PER_MEMBER = 200;
const MAX_MEMBERS = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const norm = value => String(value ?? '').trim().toLowerCase();
const exactDay = value => typeof value === 'string' && DAY.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

function azurePathSegment(value, name) {
  if (typeof value !== 'string' || !/^[\w.-]{1,100}$/.test(value)) {
    throw new Error('Invalid ' + name + ' for Azure work-item preflight.');
  }
  return encodeURIComponent(value);
}
function escapeWiql(value) {
  return value.replaceAll("'", "''");
}
function titleInSeries(title, prefix) {
  if (typeof title !== 'string') return false;
  const start = prefix.trim().toLowerCase();
  const candidate = title.trim().toLowerCase();
  return candidate.startsWith(start) && (candidate.length === start.length ||
    /[\s|:,-]/.test(candidate[start.length]));
}
function assignedToMatches(value, expected) {
  const wanted = norm(expected);
  if (typeof value === 'string') {
    const email = value.match(/<([^<>]+)>/);
    // Do not equate a display name to a stable account identity.
    return email ? norm(email[1]) === wanted : value.includes('@') && norm(value) === wanted;
  }
  if (value && typeof value === 'object') {
    return typeof value.uniqueName === 'string' && norm(value.uniqueName) === wanted;
  }
  return false;
}

export function buildWorkItemQuery(config, member, since) {
  if (!exactDay(since)) throw new Error('RELEASE_FROM_DATE must be a real YYYY-MM-DD date.');
  if (!/^[^\s@]+@[^\s@]+$/.test(member.assignedTo)) {
    throw new Error('Read-only WIQL requires an exact email/UPN; descriptor-only and display names need operator mapping.');
  }
  return 'SELECT [System.Id] FROM WorkItems' +
    " WHERE [System.TeamProject] = '" + escapeWiql(config.project) + "'" +
    " AND [System.WorkItemType] = '" + escapeWiql(config.workItemType) + "'" +
    " AND [System.AssignedTo] = '" + escapeWiql(member.assignedTo) + "'" +
    " AND [System.CreatedDate] >= '" + since + "'" +
    " AND [System.State] <> 'Removed'" +
    ' ORDER BY [System.CreatedDate] DESC';
}

export function inspectWorkItems(queryResponse, batchResponse, member, config) {
  if (!Array.isArray(queryResponse?.workItems) || queryResponse.workItems.length > MAX_ITEMS_PER_MEMBER ||
      queryResponse.workItems.some(ref => !Number.isSafeInteger(ref?.id) || ref.id <= 0)) {
    throw new Error('Invalid or oversized WIQL response; refusing to infer prefix coverage.');
  }
  const ids = queryResponse.workItems.map(ref => ref.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate WIQL work-item IDs.');
  if (ids.length === 0) return { status: 'NO_RECENT_ITEMS', matching: 0, otherSeries: 0 };

  if (!Array.isArray(batchResponse?.value) || batchResponse.value.length !== ids.length ||
      !Number.isSafeInteger(batchResponse.count) || batchResponse.count !== ids.length) {
    throw new Error('Incomplete Azure work-item batch; refusing to infer prefix coverage.');
  }
  const wanted = new Set(ids);
  const seen = new Set();
  let matching = 0;
  let otherSeries = 0;
  for (const record of batchResponse.value) {
    if (!wanted.has(record?.id) || seen.has(record.id) || !record.fields) {
      throw new Error('Azure returned mismatched or repeated work-item IDs.');
    }
    seen.add(record.id);
    const fields = record.fields;
    if (fields['System.TeamProject'] !== config.project ||
        fields['System.WorkItemType'] !== config.workItemType ||
        !assignedToMatches(fields['System.AssignedTo'], member.assignedTo)) {
      throw new Error('Azure work-item project/type/assignee mismatch; review identity and query.');
    }
    if (titleInSeries(fields['System.Title'], member.titlePrefix)) matching++;
    else otherSeries++;
  }
  return { status: matching > 0 ? 'PREFIX_OBSERVED' : 'PREFIX_NOT_FOUND', matching, otherSeries };
}

export async function verifyMemberWorkItems(config, request, since, selectedKeys = '') {
  if (!config || typeof config !== 'object') throw new Error('Invalid config.');
  const organization = azurePathSegment(config.organization, 'organization');
  const project = azurePathSegment(config.project, 'project');
  if (!config.workItemType || typeof config.workItemType !== 'string') {
    throw new Error('Work item type is required.');
  }
  if (!exactDay(since)) throw new Error('RELEASE_FROM_DATE must be a real YYYY-MM-DD date.');
  const members = selectConfiguredMembers(config, selectedKeys);
  if (members.length > MAX_MEMBERS) throw new Error('Scope exceeds 20 members; split into bounded batches.');
  const root = 'https://dev.azure.com/' + organization + '/' + project + '/_apis/wit/';
  const results = [];
  for (const member of members) {
    try {
      const query = buildWorkItemQuery(config, member, since);
      const queryResponse = await request(root + 'wiql?api-version=7.1', 'POST', { query });
      if (!Array.isArray(queryResponse?.workItems) ||
          queryResponse.workItems.length > MAX_ITEMS_PER_MEMBER) {
        throw new Error('WIQL returned incomplete or excessive candidate coverage.');
      }
      const ids = queryResponse.workItems.map(item => item?.id);
      const url = root + 'workitems?ids=' + ids.join(',') +
        '&fields=System.Id,System.Title,System.AssignedTo,System.TeamProject,System.WorkItemType&api-version=7.1';
      const batch = ids.length ? await request(url, 'GET') : { count: 0, value: [] };
      const report = inspectWorkItems(queryResponse, batch, member, config);
      results.push({ status: report.status, matching: report.matching, otherSeries: report.otherSeries });
    } catch {
      // Never print the remote payload, identity, work-item title, or PAT.
      results.push({ status: 'BLOCKED', matching: 0, otherSeries: 0 });
    }
  }
  return { passed: results.every(item => item.status === 'PREFIX_OBSERVED'), results };
}

async function main() {
  const config = JSON.parse(readFileSync(resolve(process.env.RELEASE_PEOPLE_FILE || 'people.json'), 'utf8'));
  const org = process.env.AZURE_DEVOPS_ORG?.trim() || config.organization;
  const project = process.env.AZURE_DEVOPS_PROJECT?.trim() || config.project;
  const pat = process.env.AZURE_DEVOPS_WORK_READ_PAT?.trim();
  const since = process.env.RELEASE_FROM_DATE;
  if (!pat || !since) throw new Error('Provide AZURE_DEVOPS_WORK_READ_PAT (vso.work only) and RELEASE_FROM_DATE from approved secret storage.');
  const request = async (url, method, data) => {
    const response = await fetch(url, {
      method, redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(':' + pat).toString('base64'),
        Accept: 'application/json', 'Content-Type': 'application/json',
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.status !== 200) throw new Error('Azure read-only query failed.');
    return response.json();
  };
  const report = await verifyMemberWorkItems({
    ...config, organization: org, project,
  }, request, since, process.env.RELEASE_PERSON_KEYS || '');
  console.log('Work-item prefix observation (created since ' + since + ', no remote mutations):');
  report.results.forEach((result, i) => console.log(
    'Member #' + (i + 1) + ': ' + result.status +
    ', matching=' + result.matching + ', otherSeries=' + result.otherSeries));
  if (!report.passed) process.exitCode = 1;
  console.log('A PREFIX_OBSERVED result only proves matching titles were observed in a bounded read-only query.');
  console.log('Current-day completeness, source ownership, live field rules and authorization remain unverified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Read-only work-item prefix preflight blocked. Check config, scope, dates, and read-only tenant permissions.');
    process.exitCode = 1;
  });
}
