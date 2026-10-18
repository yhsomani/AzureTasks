import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identityLookupUrl,
  inspectIdentityResponse,
  selectConfiguredMembers,
  verifyConfiguredIdentities,
} from './verify-azure-identities.mjs';

const person = (key, assignedTo, extra = {}) => ({ key, name: key, assignedTo, ...extra });
const config = people => ({ organization: 'ExampleOrg', project: 'Sample', titlePrefix: 'Example |', people });
const record = (mail, id, extra = {}) => ({
  id, isActive: true, providerDisplayName: 'Same Label',
  properties: { Mail: { $value: mail } }, ...extra,
});

test('lookup URLs only target fixed Azure identities HTTPS host with read-only query parameters', () => {
  const url = new URL(identityLookupUrl('ExampleOrg', 'alice@team.example'));
  assert.equal(url.origin, 'https://vssps.dev.azure.com');
  assert.equal(url.pathname, '/ExampleOrg/_apis/identities');
  assert.equal(url.searchParams.get('filterValue'), 'alice@team.example');
  assert.equal(url.searchParams.get('searchFilter'), 'General');
  assert.equal(url.searchParams.get('queryMembership'), 'None');
  assert.throws(() => identityLookupUrl('ExampleOrg', 'Alice Smith'), /display names are ambiguous/);
  assert.throws(() => identityLookupUrl('https://attacker.example', 'alice@team.example'), /organization/);
});

test('subject descriptors use exact descriptor resolution rather than fuzzy names', () => {
  const subjectDescriptor = 'aad.MDAwMDAwMDAwMA';
  const url = new URL(identityLookupUrl('ExampleOrg', subjectDescriptor));
  assert.equal(url.searchParams.get('subjectDescriptors'), subjectDescriptor);
  assert.equal(url.searchParams.has('searchFilter'), false);
  assert.equal(inspectIdentityResponse({
    count: 1, value: [record('ignored@example.test', 'guid-1', { subjectDescriptor })],
  }, subjectDescriptor).status, 'EXACT_ACTIVE');
});

test('exact mail match is accepted; same display name and cross-domain local parts are not', () => {
  const result = inspectIdentityResponse({
    count: 2,
    value: [
      record('alice@other.example', 'guid-1'),
      record('alice@team.example', 'guid-2'),
    ],
  }, 'alice@team.example');
  assert.deepEqual(result, { status: 'EXACT_ACTIVE', identityId: 'guid-2' });
  assert.equal(inspectIdentityResponse({
    count: 1, value: [record('alice@other.example', 'guid-1', { uniqueName: 'alice@other.example' })],
  }, 'alice@team.example').status, 'NOT_FOUND');
});

test('fail closed for partial, duplicate, inactive, group and missing-ID responses', () => {
  assert.throws(() => inspectIdentityResponse({ value: [] }, 'alice@team.example'), /Incomplete/);
  assert.throws(() => inspectIdentityResponse({ count: 2, value: [] }, 'alice@team.example'), /Incomplete/);
  assert.equal(inspectIdentityResponse({
    count: 2, value: [record('alice@team.example', 'id-a'), record('alice@team.example', 'id-b')],
  }, 'alice@team.example').status, 'AMBIGUOUS');
  assert.equal(inspectIdentityResponse({
    count: 1, value: [record('alice@team.example', 'id-a', { isActive: false })],
  }, 'alice@team.example').status, 'INACTIVE');
  assert.equal(inspectIdentityResponse({
    count: 1, value: [record('alice@team.example', 'id-a', { isContainer: true })],
  }, 'alice@team.example').status, 'NOT_FOUND');
  assert.equal(inspectIdentityResponse({
    count: 1, value: [record('alice@team.example', '')],
  }, 'alice@team.example').status, 'UNVERIFIABLE');
});

test('scope is bounded; disabled people skipped; duplicate member mappings are rejected', () => {
  const people = [person('a', 'a@team.example'), person('b', 'b@team.example', { enabled: false })];
  assert.deepEqual(selectConfiguredMembers(config(people)).map(p => p.key), ['a']);
  assert.throws(() => selectConfiguredMembers(config(people), 'b'), /enabled/);
  assert.throws(() => selectConfiguredMembers(config(people), 'missing'), /not present/);
  assert.throws(() => selectConfiguredMembers(config([
    person('a', 'a@team.example'), person('A', 'b@team.example'),
  ])), /Duplicate/);
  assert.throws(() => selectConfiguredMembers(config([
    person('a', 'a@team.example'), person('b', 'A@TEAM.EXAMPLE'),
  ])), /Duplicate/);
  assert.throws(() => selectConfiguredMembers(config([])), /No enabled/);
  assert.throws(() => selectConfiguredMembers(config(Array.from({ length: 51 },
    (_, i) => person(String(i), i + '@team.example')))), /50 members/);
});

test('per-member prefixes retained; two different accounts resolving same Azure ID fail', async () => {
  const people = [person('a', 'a@team.example', { titlePrefix: 'A |' }),
    person('b', 'b@team.example')];
  const requests = [];
  const report = await verifyConfiguredIdentities(config(people), async url => {
    requests.push(new URL(url));
    return { count: 1, value: [record(new URL(url).searchParams.get('filterValue'), 'shared-id')] };
  });
  assert.deepEqual(report.results, [
    { key: 'a', titlePrefix: 'A |', status: 'EXACT_ACTIVE' },
    { key: 'b', titlePrefix: 'Example |', status: 'DUPLICATE_IDENTITY' },
  ]);
  assert.equal(report.passed, false);
  assert.equal(requests.length, 2);
});

test('invalid display-name identity blocks one member without querying or claiming success', async () => {
  let requests = 0;
  const report = await verifyConfiguredIdentities(config([
    person('name', 'Alice Smith'), person('valid', 'valid@team.example'),
  ]), async url => {
    requests++;
    return { count: 1, value: [record(new URL(url).searchParams.get('filterValue'), 'ok-id')] };
  });
  assert.equal(requests, 1);
  assert.deepEqual(report.results.map(r => r.status), ['BLOCKED', 'EXACT_ACTIVE']);
  assert.equal(report.passed, false);
});

test('network failures never become clean identity proofs', async () => {
  const report = await verifyConfiguredIdentities(config([person('a', 'a@team.example')]),
    async () => { throw new Error('Injected network failure'); });
  assert.equal(report.passed, false);
  assert.equal(report.results[0].status, 'BLOCKED');
});
