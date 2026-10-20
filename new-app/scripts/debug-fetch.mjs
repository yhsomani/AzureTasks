/**
 * Debug script: fetches raw Azure DevOps tasks for yash_somani
 * and prints every field to diagnose why data isn't showing correctly.
 * Run: node --env-file=.env scripts/debug-fetch.mjs
 */

const PAT = process.env.AZURE_DEVOPS_PAT;
const ORG = process.env.AZURE_DEVOPS_ORG || 'BFLDevOpsOrg';
const PROJECT = process.env.AZURE_DEVOPS_PROJECT || '3in1_Agile_Projects';
const ASSIGNED_TO = 'yash.somani@bajajfinserv.in';
const TITLE_PREFIX = '3in1_PWA_MyAccount |';

const B64 = Buffer.from(`:${PAT}`).toString('base64');
const HEADERS = {
  'Authorization': `Basic ${B64}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

async function azureFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}\nURL: ${url}\nBody: ${body.slice(0, 500)}`);
  }
  return res.json();
}

// ── 1. WIQL: fetch all tasks assigned to user matching titlePrefix ───────────
console.log('\n══════════════════════════════════════════');
console.log('1. WIQL — fetching tasks assigned to user');
console.log('══════════════════════════════════════════');

const wiqlBody = {
  query: `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo],
    [System.WorkItemType], [System.CreatedDate], [System.ChangedDate]
    FROM WorkItems
    WHERE [System.TeamProject] = '${PROJECT}'
    AND [System.WorkItemType] = '3in1 Task'
    AND [System.AssignedTo] = '${ASSIGNED_TO}'
    AND [System.Title] CONTAINS '${TITLE_PREFIX}'
    AND [System.State] <> 'Removed'
    ORDER BY [System.CreatedDate] DESC`
};

const wiqlUrl = `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/wiql?api-version=7.0`;
const wiqlResult = await azureFetch(wiqlUrl, { method: 'POST', body: JSON.stringify(wiqlBody) });

const workItemRefs = wiqlResult.workItems || [];
console.log(`Found ${workItemRefs.length} work items matching WIQL`);

if (workItemRefs.length === 0) {
  console.log('\n⚠️  No items found. Trying without titlePrefix filter...');

  const wiqlBody2 = {
    query: `SELECT [System.Id], [System.Title], [System.State]
      FROM WorkItems
      WHERE [System.TeamProject] = '${PROJECT}'
      AND [System.WorkItemType] = '3in1 Task'
      AND [System.AssignedTo] = '${ASSIGNED_TO}'
      AND [System.State] <> 'Removed'
      ORDER BY [System.CreatedDate] DESC`
  };
  const wiqlResult2 = await azureFetch(wiqlUrl, { method: 'POST', body: JSON.stringify(wiqlBody2) });
  const refs2 = wiqlResult2.workItems || [];
  console.log(`Without prefix filter: ${refs2.length} items`);

  if (refs2.length > 0) {
    console.log('\nSample task IDs (first 5):', refs2.slice(0, 5).map(r => r.id));
    console.log('\n⚠️  Tasks exist but titlePrefix filter is removing them!');
    console.log('Fetching titles to compare...');
    const ids = refs2.slice(0, 10).map(r => r.id);
    const detailUrl = `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State&api-version=7.0`;
    const detail = await azureFetch(detailUrl);
    for (const item of detail.value) {
      console.log(`  #${item.id}: [${item.fields['System.State']}] ${item.fields['System.Title']}`);
    }
  }
  process.exit(0);
}

// ── 2. Fetch full details for found items (first 20) ─────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('2. Fetching full details for found items');
console.log('══════════════════════════════════════════');

const ids = workItemRefs.slice(0, 20).map(r => r.id);
const fields = [
  'System.Id', 'System.Title', 'System.State', 'System.AssignedTo',
  'System.CreatedDate', 'System.ChangedDate',
  'Custom.PlannedStartdate', 'Custom.PlannedEnddate',
  'Custom.ActualStartdate', 'Custom.ActualEnddate', 'Custom.ActualClosedDate',
  'Microsoft.VSTS.Scheduling.OriginalEstimate',
  'Microsoft.VSTS.Scheduling.CompletedWork',
  'Microsoft.VSTS.Scheduling.RemainingWork',
].join(',');

const detailUrl = `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/workitems?ids=${ids.join(',')}&fields=${fields}&api-version=7.0`;
const detail = await azureFetch(detailUrl);

console.log(`\nFetched ${detail.value.length} work items:`);
for (const item of detail.value) {
  const f = item.fields;
  console.log(`\n  ┌─ #${f['System.Id']}: ${f['System.Title']}`);
  console.log(`  │  State: ${f['System.State']}`);
  console.log(`  │  PlannedStart: ${f['Custom.PlannedStartdate'] ?? '⚠️  NULL'}`);
  console.log(`  │  PlannedEnd:   ${f['Custom.PlannedEnddate'] ?? '⚠️  NULL'}`);
  console.log(`  │  ActualStart:  ${f['Custom.ActualStartdate'] ?? 'NULL'}`);
  console.log(`  │  ActualEnd:    ${f['Custom.ActualEnddate'] ?? 'NULL'}`);
  console.log(`  │  OrigEst: ${f['Microsoft.VSTS.Scheduling.OriginalEstimate'] ?? 'NULL'}`);
  console.log(`  │  Done:    ${f['Microsoft.VSTS.Scheduling.CompletedWork'] ?? 'NULL'}`);
  console.log(`  └─ Remaining: ${f['Microsoft.VSTS.Scheduling.RemainingWork'] ?? 'NULL'}`);
}

// ── 3. Check what the app's WIQL query actually does ─────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('3. App-style WIQL (last 30 days, ordered by date)');
console.log('══════════════════════════════════════════');

const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const appWiqlBody = {
  query: `SELECT [System.Id], [System.Title], [System.State]
    FROM WorkItems
    WHERE [System.TeamProject] = '${PROJECT}'
    AND [System.WorkItemType] = '3in1 Task'
    AND [System.AssignedTo] = '${ASSIGNED_TO}'
    AND [System.Title] CONTAINS '${TITLE_PREFIX}'
    AND [System.CreatedDate] >= '${thirtyDaysAgo}'
    ORDER BY [System.CreatedDate] DESC`
};

const appWiql = await azureFetch(wiqlUrl, { method: 'POST', body: JSON.stringify(appWiqlBody) });
console.log(`Last 30 days — ${appWiql.workItems?.length ?? 0} tasks found`);
if (appWiql.workItems?.length) {
  console.log('IDs:', appWiql.workItems.map(r => r.id).join(', '));
}

// ── 4. Check for THIS week's tasks specifically ───────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('4. This week\'s tasks (Oct 19–23 2026)');
console.log('══════════════════════════════════════════');

const weekWiql = {
  query: `SELECT [System.Id], [System.Title], [System.State]
    FROM WorkItems
    WHERE [System.TeamProject] = '${PROJECT}'
    AND [System.WorkItemType] = '3in1 Task'
    AND [System.AssignedTo] = '${ASSIGNED_TO}'
    AND [System.Title] CONTAINS '${TITLE_PREFIX}'
    AND [System.CreatedDate] >= '2026-10-01'
    ORDER BY [System.Id] DESC`
};

const weekResult = await azureFetch(wiqlUrl, { method: 'POST', body: JSON.stringify(weekWiql) });
const weekRefs = weekResult.workItems || [];
console.log(`Oct 2026 onwards — ${weekRefs.length} tasks found`);
if (weekRefs.length > 0) {
  const weekIds = weekRefs.slice(0, 10).map(r => r.id);
  const weekDetail = await azureFetch(
    `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/workitems?ids=${weekIds.join(',')}&fields=System.Id,System.Title,System.State,Custom.PlannedStartdate,Custom.PlannedEnddate&api-version=7.0`
  );
  for (const item of weekDetail.value) {
    const f = item.fields;
    console.log(`  #${f['System.Id']} [${f['System.State']}] ${f['System.Title']}`);
    console.log(`    PlannedStart: ${f['Custom.PlannedStartdate'] ?? '⚠️ NULL'}  PlannedEnd: ${f['Custom.PlannedEnddate'] ?? '⚠️ NULL'}`);
  }
}

console.log('\n✅ Debug fetch complete.');
