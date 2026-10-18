#!/usr/bin/env node
/**
 * Issue #11: bounded, read-only verification of configured Azure identities.
 * This preflight intentionally does not prove project access, assignability,
 * permissions, task ownership, or suitability for production task mutations.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const identityPattern = /^[^\s@]+@[^\s@]+$/;
const descriptorPattern = /^[a-z]{2,12}\.[A-Za-z0-9_=-]{6,256}$/i;
const MAX_MEMBERS = 50;

const normalized = value => String(value ?? '').trim().toLowerCase();
const propertyValue = (identity, key) => identity?.properties?.[key]?.$value;

export function identityLookupUrl(organization, assignedTo) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(organization)) {
    throw new Error('Invalid Azure DevOps organization name.');
  }
  const url = new URL('https://vssps.dev.azure.com/' +
    encodeURIComponent(organization) + '/_apis/identities');
  if (identityPattern.test(assignedTo)) {
    url.searchParams.set('searchFilter', 'General');
    url.searchParams.set('filterValue', assignedTo);
  } else if (descriptorPattern.test(assignedTo)) {
    url.searchParams.set('subjectDescriptors', assignedTo);
  } else {
    throw new Error('Identity must be an exact email/UPN or Azure subject descriptor; display names are ambiguous.');
  }
  url.searchParams.set('queryMembership', 'None');
  url.searchParams.set('api-version', '7.1');
  return url.toString();
}

function isExactIdentity(identity, assignedTo) {
  if (!identity || typeof identity !== 'object' || identity.isContainer === true) return false;
  const candidate = normalized(assignedTo);
  if (descriptorPattern.test(assignedTo)) {
    return normalized(identity.subjectDescriptor) === candidate;
  }
  // Only stable account/mail properties count; a display-name match does not.
  return [identity.uniqueName, propertyValue(identity, 'Mail'),
    propertyValue(identity, 'Account'), propertyValue(identity, 'AccountName')]
    .some(value => normalized(value) === candidate);
}

export function inspectIdentityResponse(response, assignedTo) {
  if (!response || !Array.isArray(response.value) ||
      !Number.isSafeInteger(response.count) || response.count !== response.value.length) {
    throw new Error('Incomplete Azure identity lookup response; refusing to infer a match.');
  }
  const matching = response.value.filter(identity => isExactIdentity(identity, assignedTo));
  if (matching.length === 0) return { status: 'NOT_FOUND' };
  if (matching.length !== 1) return { status: 'AMBIGUOUS' };
  const record = matching[0];
  if (!record.id || typeof record.id !== 'string') return { status: 'UNVERIFIABLE' };
  if (record.isActive !== true) return { status: 'INACTIVE' };
  return { status: 'EXACT_ACTIVE', identityId: record.id };
}

export function selectConfiguredMembers(config, selectedKeys = '') {
  if (!config || !Array.isArray(config.people)) {
    throw new Error('people.json must contain a people array.');
  }
  const people = config.people;
  const requested = new Set(selectedKeys.split(',').map(normalized).filter(Boolean));
  const known = new Set(people.map(person => normalized(person?.key)));
  for (const key of requested) {
    if (!known.has(key)) throw new Error('Requested member key is not present in people.json.');
  }
  const active = people.filter(person => person?.enabled !== false &&
    (!requested.size || requested.has(normalized(person?.key))));
  if (active.length === 0) throw new Error('No enabled people selected; no live identities checked.');
  if (active.length > MAX_MEMBERS) throw new Error('Scope exceeds 50 members; run smaller bounded batches.');
  if (requested.size !== 0 && active.length !== requested.size) {
    throw new Error('Selected members must be enabled before verification.');
  }
  const seenKeys = new Set(), seenAccounts = new Set();
  return active.map(person => {
    const key = String(person?.key ?? '').trim();
    const assignedTo = String(person?.assignedTo ?? '').trim();
    const titlePrefix = String(person?.titlePrefix ?? config.titlePrefix ?? '').trim();
    if (!key || !assignedTo || !titlePrefix || titlePrefix.length > 200) {
      throw new Error('Active members require key, assignedTo and bounded titlePrefix.');
    }
    if (seenKeys.has(normalized(key)) || seenAccounts.has(normalized(assignedTo))) {
      throw new Error('Duplicate active member key or assignedTo detected.');
    }
    seenKeys.add(normalized(key));
    seenAccounts.add(normalized(assignedTo));
    return { key, assignedTo, titlePrefix };
  });
}

export async function verifyConfiguredIdentities(config, request, selectedKeys = '') {
  const members = selectConfiguredMembers(config, selectedKeys);
  const organization = String(config.organization ?? '').trim();
  const seenIdentityIds = new Set();
  const results = [];
  for (const member of members) {
    // Invalid display names become an explicit failed result; no fuzzy fallback.
    let inspected;
    try {
      const url = identityLookupUrl(organization, member.assignedTo);
      inspected = inspectIdentityResponse(await request(url), member.assignedTo);
    } catch (error) {
      inspected = { status: 'BLOCKED', reason: error instanceof Error ? error.message : 'Lookup failed' };
    }
    if (inspected.status === 'EXACT_ACTIVE') {
      if (seenIdentityIds.has(inspected.identityId)) {
        inspected = { status: 'DUPLICATE_IDENTITY' };
      } else {
        seenIdentityIds.add(inspected.identityId);
      }
    }
    results.push({ key: member.key, titlePrefix: member.titlePrefix, status: inspected.status });
  }
  return { results, passed: results.every(result => result.status === 'EXACT_ACTIVE') };
}

async function main() {
  const file = resolve(process.env.RELEASE_PEOPLE_FILE || 'people.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const organization = process.env.AZURE_DEVOPS_ORG?.trim() || config.organization;
  const project = process.env.AZURE_DEVOPS_PROJECT?.trim() || config.project;
  const pat = process.env.AZURE_DEVOPS_PAT?.trim();
  if (!organization || !project || !pat) {
    throw new Error('Provide organization, project and a NEW least-privilege AZURE_DEVOPS_PAT via approved secret storage.');
  }
  const request = async url => {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(':' + pat).toString('base64'),
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) {
      throw new Error('Identity service returned a non-200 response (check vso.identity access and organization).');
    }
    return response.json();
  };
  // The file's scope cannot silently select another organization.
  const report = await verifyConfiguredIdentities(
    { ...config, organization }, request, process.env.RELEASE_PERSON_KEYS || '');
  console.log('Read-only Azure identity preflight for project ' + project + ':');
  for (const result of report.results) {
    // Print stable local keys, not names, email addresses, PATs or GUIDs.
    console.log(result.key + ': ' + result.status + ' (configured title prefix present)');
  }
  if (!report.passed) {
    console.error('Identity verification blocked. Fix missing, inactive or ambiguous mappings before task mutations.');
    process.exitCode = 1;
  } else {
    console.log('All selected accounts resolved exactly and are active. Project assignability, tenant fields and task writes remain UNVERIFIED.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Do not echo exception values from file, network or identity providers:
    // they may include corporate personal data or credential-bearing URLs.
    console.error('Read-only identity preflight failed. Check local configuration, identity scopes and connectivity.');
    process.exitCode = 1;
  });
}
