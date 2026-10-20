import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectConfiguredMembers } from '/Users/yashsomani/Desktop/Asure Bord Project/new-app/scripts/verify-azure-identities.mjs';
import { buildWorkItemQuery, inspectWorkItems, verifyMemberWorkItems } from '/Users/yashsomani/Desktop/Asure Bord Project/new-app/scripts/verify-azure-workitems.mjs';

const config = JSON.parse(readFileSync('/Users/yashsomani/Desktop/Asure Bord Project/new-app/people.json', 'utf8'));
const env = readFileSync('/Users/yashsomani/Desktop/Asure Bord Project/new-app/.env', 'utf8');
const patMatch = env.match(/AZURE_DEVOPS_PAT="?([^"\r\n]+)"?/);
const pat = patMatch ? patMatch[1].trim() : '';
const org = 'BFLDevOpsOrg';
const project = '3in1_Agile_Projects';
const since = '2026-10-01';

const request = async (url, method, data) => {
  console.log(`[REQUEST] ${method} ${url}`);
  const response = await fetch(url, {
    method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: 'Basic ' + Buffer.from(':' + pat).toString('base64'),
      Accept: 'application/json', 'Content-Type': 'application/json',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  console.log(`[RESPONSE] ${response.status} ${response.statusText}`);
  if (response.status !== 200) {
    const body = await response.text();
    console.error(`[ERROR BODY]`, body);
    throw new Error('Azure read-only query failed: ' + response.status);
  }
  return response.json();
};

try {
  const members = selectConfiguredMembers(config, '');
  for (const member of members) {
    const query = buildWorkItemQuery(config, member, since);
    console.log('[QUERY]', query);
    const root = 'https://dev.azure.com/' + org + '/' + project + '/_apis/wit/';
    const queryResponse = await request(root + 'wiql?api-version=7.1', 'POST', { query });
    console.log('[WIQL RES] items:', queryResponse.workItems?.length);
    const ids = queryResponse.workItems.map(item => item?.id);
    const url = root + 'workitems?ids=' + ids.join(',') +
      '&fields=System.Id,System.Title,System.AssignedTo,System.TeamProject,System.WorkItemType&api-version=7.1';
    const batch = ids.length ? await request(url, 'GET') : { count: 0, value: [] };
    console.log('[BATCH RES] count:', batch.count);
    const report = inspectWorkItems(queryResponse, batch, member, config);
    console.log('[REPORT]', report);
  }
} catch (e) {
  console.error('[CAUGHT EXCEPTION]', e);
}
