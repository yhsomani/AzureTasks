import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkItemQuery,
  inspectWorkItems,
  verifyMemberWorkItems,
} from './verify-azure-workitems.mjs';

const member = (key, assignedTo, titlePrefix = '3in1 |') =>
  ({ key, name: key, assignedTo, titlePrefix });
const config = people => ({
  organization: 'ExampleOrg', project: 'Example_Project',
  workItemType: '3in1 Task', titlePrefix: '3in1 |', people,
});
const item = (id, assignedTo, title, extra = {}) => ({
  id, fields: {
    'System.TeamProject': 'Example_Project',
    'System.WorkItemType': '3in1 Task',
    'System.AssignedTo': { uniqueName: assignedTo, displayName: 'Duplicate Name' },
    'System.Title': title, ...extra,
  },
});
const wiql = (...ids) => ({ workItems: ids.map(id => ({ id })) });
const batch = (...items) => ({ count: items.length, value: items });

test('read-only WIQL scopes to project/type/explicit account and a validated creation date', () => {
  const q = buildWorkItemQuery(config([]), member('a', "anna.o'neil@example.test"), '2026-10-01');
  assert.match(q, /\[System\.CreatedDate\] >= '2026-10-01'/);
  assert.match(q, /\[System\.TeamProject\] = 'Example_Project'/);
  assert.match(q, /\[System\.WorkItemType\] = '3in1 Task'/);
  assert.match(q, /anna\.o''neil@example\.test/);
  assert.doesNotMatch(q, /UPDATE|DELETE|INSERT/i);
  assert.throws(() => buildWorkItemQuery(config([]), member('a', 'Anna Smith'), '2026-10-01'), /exact email/);
  assert.throws(() => buildWorkItemQuery(config([]), member('a', 'a@example.test'), '2026-02-30'), /real YYYY/);
});

test('observes canonical spacing and isolates other work item series', () => {
  const report = inspectWorkItems(wiql(1, 2), batch(
    item(2, 'a@example.test', 'Other | 1 Oct'),
    item(1, 'a@example.test', '3in1 |  1 Oct'),
  ), member('a', 'a@example.test'), config([]));
  assert.deepEqual(report, { status: 'PREFIX_OBSERVED', matching: 1, otherSeries: 1 });
});

test('will not treat substring prefixes as a matching series', () => {
  const report = inspectWorkItems(wiql(1), batch(
    item(1, 'a@example.test', '3in1X | 1 Oct')),
    member('a', 'a@example.test', '3in1'), config([]));
  assert.equal(report.status, 'PREFIX_NOT_FOUND');
  assert.deepEqual(inspectWorkItems(wiql(), batch(), member('a', 'a@example.test'), config([])),
    { status: 'NO_RECENT_ITEMS', matching: 0, otherSeries: 0 });
});

test('rejects missing, duplicated, oversized and mismatched read backs', () => {
  const m = member('a', 'a@example.test');
  const good = item(1, 'a@example.test', '3in1 | 1 Oct');
  assert.throws(() => inspectWorkItems(wiql(1, 2), batch(good), m, config([])), /Incomplete/);
  assert.throws(() => inspectWorkItems(wiql(1, 1), batch(good, good), m, config([])), /Duplicate WIQL/);
  assert.throws(() => inspectWorkItems(wiql(1), batch(item(2, 'a@example.test', '3in1 | 1 Oct')), m, config([])), /mismatched/);
  assert.throws(() => inspectWorkItems(wiql(1), batch(item(1, 'a@other.test', '3in1 | 1 Oct')), m, config([])), /mismatch/);
  assert.throws(() => inspectWorkItems(wiql(1), batch(item(1, 'a@example.test', '3in1 | 1 Oct', {
    'System.TeamProject': 'other',
  })), m, config([])), /mismatch/);
  assert.throws(() => inspectWorkItems(wiql(...Array.from({ length: 201 }, (_, i) => i + 1)),
    batch(), m, config([])), /oversized/);
  assert.throws(() => inspectWorkItems({ workItems: null }, batch(), m, config([])), /Invalid/);
});

test('scope is bounded and attempts only documented read-only Azure endpoints', async () => {
  const requests = [];
  const report = await verifyMemberWorkItems(config([
    member('a', 'a@example.test'), member('b', 'b@example.test'),
  ]), async (url, method, body) => {
    requests.push({ url, method, body });
    if (method === 'POST') return wiql(requests.length === 1 ? 10 : 20);
    return batch(item(requests.length === 2 ? 10 : 20,
      requests.length === 2 ? 'a@example.test' : 'b@example.test', '3in1 |  1 Oct'));
  }, '2026-10-01');
  assert.equal(report.passed, true);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map(r => r.method), ['POST', 'GET', 'POST', 'GET']);
  assert.ok(requests.every(r => new URL(r.url).origin === 'https://dev.azure.com'));
  assert.ok(requests.filter(r => r.method === 'POST')
    .every(r => r.url.includes('/_apis/wit/wiql?') && r.body.query.startsWith('SELECT ')));
  assert.ok(requests.filter(r => r.method === 'GET')
    .every(r => r.url.includes('/_apis/wit/workitems?ids=')));
});

test('network errors, unsupported identity formats and unknown keys block', async () => {
  const invalid = await verifyMemberWorkItems(config([member('a', 'Alice Smith')]),
    async () => { throw new Error('Should not be called'); }, '2026-10-01');
  assert.equal(invalid.results[0].status, 'BLOCKED');
  assert.equal(invalid.passed, false);
  const failed = await verifyMemberWorkItems(config([member('a', 'a@example.test')]),
    async () => { throw new Error('Sensitive Azure server error'); }, '2026-10-01');
  assert.equal(failed.results[0].status, 'BLOCKED');
  assert.deepEqual(Object.keys(failed.results[0]), ['status', 'matching', 'otherSeries']);
  await assert.rejects(verifyMemberWorkItems(config([member('a', 'a@example.test')]),
    async () => wiql(), '2026-10-01', 'other'), /not present/);
  await assert.rejects(verifyMemberWorkItems(config([member('a', 'a@example.test')]),
    async () => wiql(), 'not-a-date'), /real YYYY/);
});

test('a missing recent task or invalid work-item response is not a passing result', async () => {
  const missing = await verifyMemberWorkItems(config([member('a', 'a@example.test')]),
    async () => wiql(), '2026-10-01');
  assert.equal(missing.passed, false);
  assert.equal(missing.results[0].status, 'NO_RECENT_ITEMS');
  const invalid = await verifyMemberWorkItems(config([member('a', 'a@example.test')]),
    async (url, method) => method === 'POST' ? wiql(1) : { count: 0, value: [] }, '2026-10-01');
  assert.equal(invalid.results[0].status, 'BLOCKED');
});

test('multiple members require selected batches of at most 20', async () => {
  const many = Array.from({ length: 21 }, (_, i) => member('member' + i, 'm' + i + '@example.test'));
  await assert.rejects(
    verifyMemberWorkItems(config(many), async () => wiql(), '2026-10-01'),
    /20 members/);
});
