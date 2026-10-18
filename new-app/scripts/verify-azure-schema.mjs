#!/usr/bin/env node
/**
 * Read-only Azure work-item-type schema preflight.
 * Does not create, update, close or repair Azure work items.
 */
import { pathToFileURL } from 'node:url';

export const creationFields = [
  'System.Title',
  'System.AssignedTo',
  'System.State',
  'Microsoft.VSTS.Scheduling.StartDate',
  'Custom.PlannedStartdate',
  'Custom.PlannedEnddate',
  'Custom.GenAIEnabled',
];
export function inspectWorkItemSchema(typeDef, fieldsDef, fields = creationFields) {
  if (!typeDef || typeof typeDef.name !== 'string' ||
      !fieldsDef || !Array.isArray(fieldsDef.value)) {
    throw new Error('Azure returned incomplete work-item-type schema metadata.');
  }
  const available = new Set(fieldsDef.value.map(field => field?.referenceName).filter(Boolean));
  const missing = fields.filter(reference => !available.has(reference));
  const states = Array.isArray(typeDef.states)
    ? typeDef.states.map(state => state?.name).filter(Boolean) : [];
  const missingStates = ['New', 'Closed'].filter(name =>
    !states.some(actual => actual.toLowerCase() === name.toLowerCase()));
  return { workItemType: typeDef.name, count: available.size, missing, missingStates,
    compatible: missing.length === 0 && missingStates.length === 0 };
}
async function main() {
  const organization = process.env.AZURE_DEVOPS_ORG?.trim();
  const project = process.env.AZURE_DEVOPS_PROJECT?.trim();
  const type = process.env.AZURE_DEVOPS_WORK_ITEM_TYPE?.trim() || '3in1 Task';
  const pat = process.env.AZURE_DEVOPS_PAT?.trim();
  if (!organization || !project || !pat) {
    throw new Error('Supply AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT and AZURE_DEVOPS_PAT from approved secret storage.');
  }
  const root = 'https://dev.azure.com/' + encodeURIComponent(organization) +
    '/' + encodeURIComponent(project) +
    '/_apis/wit/workitemtypes/' + encodeURIComponent(type);
  const headers = { Authorization: 'Basic ' + Buffer.from(':' + pat).toString('base64'),
    Accept: 'application/json' };
  async function get(url) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      throw new Error('Azure DevOps schema preflight received HTTP ' + response.status +
        '. Check tenant, permissions and process configuration.');
    }
    return response.json();
  }
  const [typeDef, fieldsDef] = await Promise.all([
    get(root + '?api-version=7.1'),
    get(root + '/fields?api-version=7.1'),
  ]);
  const result = inspectWorkItemSchema(typeDef, fieldsDef);
  console.log('Azure work-item type: ' + result.workItemType);
  console.log('Available field references: ' + result.count);
  if (result.missing.length) console.error('Missing creation field(s): ' + result.missing.join(', '));
  if (result.missingStates.length) console.error('Missing workflow state(s): ' + result.missingStates.join(', '));
  if (!result.compatible) process.exitCode = 1;
  else console.log('Required creation fields and New/Closed states are present (read-only preflight).');
  console.log('Field permissions, conditional rules and actual writes still require authorized staging tests.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Schema preflight failed: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
