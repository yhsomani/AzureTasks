export const MODES = Object.freeze(['dashboard', 'full', 'forensic']);

export function parseArguments(argv = process.argv.slice(2)) {
  const read = (name, fallback = '') => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1].trim() : fallback;
  };
  const has = name => argv.includes(`--${name}`);
  const mode = read('mode', process.env.AZURE_EXPORT_MODE || 'dashboard');
  if (!MODES.includes(mode)) throw new Error(`Invalid export mode: ${mode}. Expected ${MODES.join(', ')}.`);
  const projects = read('projects', read('project', process.env.AZURE_EXPORT_PROJECTS || '3_in_1_AppFrontEnd_Tasks,3in1_Agile_Projects'))
    .split(',').map(value => value.trim()).filter(Boolean);
  return {
    mode,
    projects,
    projectSet: new Set(projects.map(value => value.toLowerCase())),
    organization: read('org', process.env.AZURE_DEVOPS_ORG || 'BFLDevOpsOrg'),
    output: read('output', process.env.AZURE_EXPORT_OUTPUT || 'azure-data.db'),
    resumeRunId: read('resume', process.env.AZURE_EXPORT_RESUME || ''),
    categories: read('categories', '').split(',').map(value => value.trim()).filter(Boolean),
    since: read('since', process.env.AZURE_EXPORT_SINCE || ''),
    dryRun: has('dry-run'),
    maxPages: Number.parseInt(process.env.AZURE_EXPORT_MAX_PAGES || '100000', 10),
    maxWorkItems: Number.parseInt(process.env.AZURE_EXPORT_MAX_WORK_ITEMS || '1000000', 10),
    maxChildren: Number.parseInt(process.env.AZURE_EXPORT_MAX_CHILDREN || '1000000', 10),
    delayMs: Number.parseInt(process.env.AZURE_EXPORT_DELAY_MS || '40', 10),
    concurrency: Number.parseInt(process.env.AZURE_EXPORT_CONCURRENCY || '3', 10),
  };
}

export function modeAllows(config, feature) {
  const dashboard = new Set(['projects', 'teams', 'dashboards', 'workItems', 'repositories', 'pullRequests', 'pipelines', 'builds', 'releases', 'tests', 'wikis']);
  const full = new Set([...dashboard, 'commits', 'revisions', 'comments', 'testResults', 'relations', 'serviceResources']);
  if (config.mode === 'dashboard') return dashboard.has(feature);
  if (config.mode === 'full') return full.has(feature);
  return true;
}
