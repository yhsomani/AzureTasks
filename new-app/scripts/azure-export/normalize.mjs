import { DatabaseSync } from 'node:sqlite';
import { NORMALIZED_SCHEMA } from './schema.mjs';

const values = payload => Array.isArray(payload?.value) ? payload.value : Array.isArray(payload) ? payload : payload ? [payload] : [];
const safe = (value, fallback = null) => value === undefined || value === '' ? fallback : value;

export function normalizeDatabase(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(NORMALIZED_SCHEMA);
  const datasets = db.prepare('SELECT project_name,scope,payload FROM datasets').all();
  const runId = db.prepare("SELECT value FROM export_meta WHERE key='runId'").get()?.value ||
    db.prepare('SELECT run_id FROM exports ORDER BY started_at DESC LIMIT 1').get()?.run_id || null;
  const syncedAt = new Date().toISOString();
  const projectLookup = new Map();
  const projectNameLookup = name => db.prepare("SELECT project_id FROM azure_projects WHERE name=? OR replace(name,' ','_')=? LIMIT 1").get(name, name)?.project_id;

  db.exec('BEGIN');
  try {
    db.exec(`
      DELETE FROM work_item_revisions; DELETE FROM test_suites; DELETE FROM pipeline_runs;
      DELETE FROM team_members; DELETE FROM repository_refs; DELETE FROM pull_requests;
      DELETE FROM work_items; DELETE FROM builds; DELETE FROM releases; DELETE FROM test_runs;
      DELETE FROM test_plans; DELETE FROM wikis; DELETE FROM repositories; DELETE FROM pipelines;
      DELETE FROM identities; DELETE FROM azure_teams; DELETE FROM azure_projects;
    `);
    for (const row of datasets) {
      const projectDetail = row.scope.match(/^project\.([^.]+)\.details$/);
      if (!projectDetail || row.project_name !== projectDetail[1]) continue;
      const projectKey = row.scope.slice('project.'.length).split('.')[0];
      if (row.project_name !== projectKey) continue;
      const item = JSON.parse(row.payload);
      if (!item?.id || !item?.name) continue;
      db.prepare(`INSERT OR REPLACE INTO azure_projects(project_id,name,state,visibility,revision,last_update_time,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(String(item.id), item.name, safe(item.state), safe(item.visibility), safe(item.revision), safe(item.lastUpdateTime), runId, syncedAt);
      projectLookup.set(projectKey, String(item.id));
      projectLookup.set(item.name, String(item.id));
    }

    const resolveProject = row => projectLookup.get(row.project_name) || projectNameLookup(row.project_name);
    const insertIdentities = (members, teamId) => {
      for (const item of members) {
        const id = String(safe(item.id, safe(item.identity?.id, safe(item.descriptor, safe(item.uniqueName, item.displayName)))) || '');
        if (!id) continue;
        db.prepare(`INSERT OR REPLACE INTO identities(identity_id,display_name,unique_name,email,subject_descriptor,is_active,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, safe(item.displayName, safe(item.name)), safe(item.uniqueName), safe(item.mailAddress, safe(item.email, item.uniqueName)),
            safe(item.descriptor, item.subjectDescriptor), item.isActive === false ? 0 : 1, runId, syncedAt);
        db.prepare('INSERT OR IGNORE INTO team_members(team_id,identity_id,sync_run_id,synced_at) VALUES (?,?,?,?)').run(teamId, id, runId, syncedAt);
      }
    };

    for (const row of datasets) {
      const projectId = resolveProject(row);
      if (!projectId) continue;
      const payload = JSON.parse(row.payload);

      if (row.scope.endsWith('.teams')) {
        for (const item of values(payload)) {
          if (!safe(item.id, item.name) || !item.name) continue;
          db.prepare(`INSERT OR REPLACE INTO azure_teams(team_id,project_id,name,description,sync_run_id,synced_at) VALUES (?,?,?,?,?,?)`)
            .run(String(safe(item.id, item.name)), projectId, item.name, safe(item.description), runId, syncedAt);
        }
      } else if (/\.team\.[^.]+\.members$/.test(row.scope)) {
        const teamKey = row.scope.split('.team.')[1].split('.')[0];
        const teamId = db.prepare("SELECT team_id FROM azure_teams WHERE project_id=? AND (replace(name,' ','_')=? OR team_id=?) LIMIT 1").get(projectId, teamKey, teamKey)?.team_id;
        if (teamId) insertIdentities(values(payload), teamId);
      } else if (row.scope.endsWith('.repositories')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO repositories(repository_id,project_id,name,default_branch,remote_url,web_url,is_disabled,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(String(item.id), projectId, item.name, safe(item.defaultBranch), safe(item.remoteUrl), safe(item.webUrl), item.isDisabled ? 1 : 0, runId, syncedAt);
      } else if (/\.repository\.[^.]+\.refs$/.test(row.scope)) {
        const repositoryKey = row.scope.split('.repository.')[1].split('.')[0];
        const repositoryId = db.prepare("SELECT repository_id FROM repositories WHERE project_id=? AND (replace(name,' ','_') LIKE ? OR repository_id=?) LIMIT 1").get(projectId, `%${repositoryKey}%`, repositoryKey)?.repository_id;
        if (repositoryId) for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO repository_refs(repository_id,ref_name,object_id,peeled_object_id,sync_run_id,synced_at) VALUES (?,?,?,?,?,?)`)
          .run(repositoryId, item.name, safe(item.objectId), safe(item.peeledObjectId), runId, syncedAt);
      } else if (row.scope.endsWith('.workItems')) {
        for (const item of values(payload)) {
          const f = item.fields || {};
          db.prepare(`INSERT OR REPLACE INTO work_items(project_id,work_item_id,type,title,state,assigned_identity_id,area_path,iteration_path,created_at,changed_at,closed_at,parent_id,tags,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(projectId, Number(item.id), safe(f['System.WorkItemType']), safe(f['System.Title']), safe(f['System.State']),
              safe(f['System.AssignedTo']?.id, f['System.AssignedTo']?.descriptor), safe(f['System.AreaPath']), safe(f['System.IterationPath']),
              safe(f['System.CreatedDate']), safe(f['System.ChangedDate']), safe(f['Microsoft.VSTS.Common.ClosedDate']), null,
              safe(f['System.Tags']), JSON.stringify(item), runId, syncedAt);
        }
      } else if (/\.workItem\.[^.]+\.revisions$/.test(row.scope)) {
        const workItemId = Number(row.scope.split('.workItem.')[1].split('.')[0]);
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO work_item_revisions(project_id,work_item_id,revision,state,changed_by_identity_id,changed_at,fields_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(projectId, workItemId, Number(item.rev), safe(item.fields?.['System.State']), safe(item.fields?.['System.ChangedBy']?.id),
            safe(item.fields?.['System.ChangedDate']), JSON.stringify(item.fields || item), runId, syncedAt);
      } else if (/\.repository\.[^.]+\.pullRequests$/.test(row.scope)) {
        const repositoryKey = row.scope.split('.repository.')[1].split('.pullRequests')[0];
        const repositoryId = db.prepare("SELECT repository_id FROM repositories WHERE project_id=? AND (replace(name,' ','_') LIKE ? OR repository_id=?) LIMIT 1").get(projectId, `%${repositoryKey}%`, repositoryKey)?.repository_id;
        if (repositoryId) for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO pull_requests(pull_request_id,repository_id,project_id,title,description,status,source_branch,target_branch,creator_identity_id,created_at,closed_at,merge_status,is_draft,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.pullRequestId), repositoryId, projectId, safe(item.title), safe(item.description), safe(item.status), safe(item.sourceRefName), safe(item.targetRefName),
            safe(item.createdBy?.id), safe(item.creationDate), safe(item.closedDate), safe(item.mergeStatus), item.isDraft ? 1 : 0, JSON.stringify(item), runId, syncedAt);
      } else if (row.scope.endsWith('.pipelines')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO pipelines(pipeline_id,project_id,name,folder,revision,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), projectId, safe(item.name), safe(item.folder), safe(item.revision), JSON.stringify(item), runId, syncedAt);
      } else if (/\.pipeline\.[^.]+\.runs$/.test(row.scope)) {
        const pipelineId = Number(row.scope.split('.pipeline.')[1].split('.')[0]);
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO pipeline_runs(run_id,pipeline_id,project_id,name,state,result,created_at,finished_at,source_branch,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), pipelineId, projectId, safe(item.name), safe(item.state), safe(item.result), safe(item.createdDate), safe(item.finishedDate),
            safe(item.resources?.repositories?.self?.refName), JSON.stringify(item), runId, syncedAt);
      } else if (row.scope.endsWith('.builds')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO builds(build_id,project_id,definition_id,build_number,status,result,reason,queue_time,start_time,finish_time,source_branch,source_version,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), projectId, safe(item.definition?.id), safe(item.buildNumber), safe(item.status), safe(item.result), safe(item.reason), safe(item.queueTime),
            safe(item.startTime), safe(item.finishTime), safe(item.sourceBranch), safe(item.sourceVersion), JSON.stringify(item), runId, syncedAt);
      } else if (row.scope.endsWith('.releases')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO releases(release_id,project_id,definition_id,name,status,reason,created_at,modified_at,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), projectId, safe(item.releaseDefinition?.id), safe(item.name), safe(item.status), safe(item.reason), safe(item.createdOn),
            safe(item.modifiedOn), JSON.stringify(item), runId, syncedAt);
      } else if (row.scope.endsWith('.testPlans')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO test_plans(plan_id,project_id,name,description,state,owner_identity_id,start_date,end_date,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), projectId, safe(item.name), safe(item.description), safe(item.state), safe(item.owner?.id), safe(item.startDate), safe(item.endDate), JSON.stringify(item), runId, syncedAt);
      } else if (/\.testPlan\.[^.]+\.suites$/.test(row.scope)) {
        const planId = Number(row.scope.split('.testPlan.')[1].split('.')[0]);
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO test_suites(suite_id,plan_id,parent_suite_id,project_id,name,suite_type,state,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), planId, safe(item.parentSuite?.id), projectId, safe(item.name), safe(item.suiteType), safe(item.state), JSON.stringify(item), runId, syncedAt);
      } else if (row.scope.endsWith('.testRuns')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO test_runs(run_id,project_id,plan_id,name,state,outcome,started_at,completed_at,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(Number(item.id), projectId, safe(item.plan?.id), safe(item.name), safe(item.state), safe(item.outcome), safe(item.startedDate), safe(item.completedDate), JSON.stringify(item), runId, syncedAt);
      } else if (row.scope.endsWith('.wikis')) {
        for (const item of values(payload)) db.prepare(`INSERT OR REPLACE INTO wikis(wiki_id,project_id,name,type,mapped_path,repository_id,payload_json,sync_run_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(String(item.id), projectId, safe(item.name), safe(item.type), safe(item.mappedPath), safe(item.repositoryId), JSON.stringify(item), runId, syncedAt);
      }
    }
    db.exec('COMMIT');
    const result = {
      projects: db.prepare('SELECT COUNT(*) AS count FROM azure_projects').get().count,
      workItems: db.prepare('SELECT COUNT(*) AS count FROM work_items').get().count,
      repositories: db.prepare('SELECT COUNT(*) AS count FROM repositories').get().count,
      pullRequests: db.prepare('SELECT COUNT(*) AS count FROM pull_requests').get().count,
      builds: db.prepare('SELECT COUNT(*) AS count FROM builds').get().count,
    };
    db.prepare('INSERT OR REPLACE INTO export_meta(key,value) VALUES (?,?)').run('normalizedAt', syncedAt);
    db.prepare('INSERT OR REPLACE INTO export_meta(key,value) VALUES (?,?)').run('normalizationSummary', JSON.stringify(result));
    db.prepare('INSERT OR REPLACE INTO export_meta(key,value) VALUES (?,?)').run('normalizationPending', 'false');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
