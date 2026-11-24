/**
 * Person Entity and Value Objects
 * Core domain model for team members
 */

export interface PersonConfig {
  key: string;           // Stable person key (e.g. "person1")
  name: string;          // Display name
  assignedTo: string;    // Email, UPN, displayName, or identity descriptor
  enabled?: boolean;     // Defaults to true
  autoCloseEnabled?: boolean; // Whether this person's tasks are included in EOD auto-closure. Defaults to true.
  sourceTaskId?: number; // Optional per-person source work item override
  pod?: string;          // Team or POD name
  role?: string;         // Role in the company
  titlePrefix?: string;  // Optional custom or POD-specific title prefix override (e.g. "3in1_PWA_FD_Services |")
  githubUsername?: string; // Optional GitHub handle override (e.g. "octocat")
  githubRepositories?: string[]; // Explicit owner/repo allowlist for commit evidence
  githubBranches?: string[]; // Branch names within the configured repositories
  aliases?: string[]; // Support registered email/UPN/descriptor/GUID aliases
  canonicalId?: string; // Canonical identity identifier (e.g. 'usr_jane')
}

export interface PersonIdentity {
  assignedTo: string;
  normalized: string;
}

/**
 * Create a stable person key from assignedTo
 */
export function createPersonKey(assignedTo: string): string {
  return assignedTo.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
}

/**
 * Normalize identity for comparison
 */
export function normalizeIdentity(identity: string): string {
  return identity.trim().toLowerCase();
}

export interface ExtractedIdentity {
  displayName: string;
  uniqueName?: string;
  identityId?: string;
  descriptor?: string;
  email?: string;
}

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIMS_DESCRIPTOR_REGEX = /^(claims(\.vss)?:sid:|vss:sid:|claims:aad:)/i;
const SUBJECT_DESCRIPTOR_REGEX = /^[a-z]{2,12}\.[A-Za-z0-9_=-]{6,256}$/i;

/**
 * Extracts normalized identity details from an Azure DevOps AssignedTo field value
 */
export function extractIdentity(assignedToVal: unknown): ExtractedIdentity | null {
  if (!assignedToVal) return null;

  if (typeof assignedToVal === 'object' && assignedToVal !== null) {
    let obj = assignedToVal as Record<string, unknown>;
    if (typeof obj.identity === 'object' && obj.identity !== null) {
      obj = obj.identity as Record<string, unknown>;
    }

    const id = obj.id || obj.identityId || obj.uuid;
    const identityId = id ? String(id).trim() : undefined;

    const desc = obj.descriptor || obj.subjectDescriptor;
    const descriptor = desc ? String(desc).trim() : undefined;

    const mail = obj.email || obj.mailAddress || obj.mail;
    const email = mail ? String(mail).trim() : undefined;

    const unique = obj.uniqueName || obj.userPrincipalName || email;
    const uniqueName = unique ? String(unique).trim() : undefined;

    const rawDisplay = obj.displayName || obj.name;
    const displayName = rawDisplay
      ? String(rawDisplay).trim()
      : (uniqueName || email || descriptor || identityId || '');

    // Return null if object is empty / contains only whitespace
    if (!displayName && !uniqueName && !identityId && !descriptor && !email) {
      return null;
    }

    const result: ExtractedIdentity = { displayName: displayName || 'Unknown' };
    if (uniqueName) result.uniqueName = uniqueName;
    if (identityId) result.identityId = identityId;
    if (descriptor) result.descriptor = descriptor;
    if (email && email !== uniqueName) result.email = email;

    // Provide non-enumerable fallback for .email so result.email always works without breaking toEqual
    if (!result.email && uniqueName && uniqueName.includes('@')) {
      Object.defineProperty(result, 'email', {
        get() { return uniqueName; },
        enumerable: false,
        configurable: true,
      });
    }

    return result;
  }

  if (typeof assignedToVal === 'string') {
    const raw = assignedToVal.trim();
    if (!raw) return null;

    // Angle-bracket format: "Name <email@domain.com>"
    const emailMatch = raw.match(/<([^>]+)>/);
    if (emailMatch) {
      const uniqueName = emailMatch[1].trim();
      const displayName = raw.replace(/<[^>]+>/, '').trim();
      const result: ExtractedIdentity = {
        displayName: displayName || uniqueName,
        uniqueName,
      };
      Object.defineProperty(result, 'email', {
        get() { return uniqueName; },
        enumerable: false,
        configurable: true,
      });
      return result;
    }

    // Azure Claims Descriptor prefix: claims.vss:sid:..., vss:sid:..., claims:aad:...
    if (CLAIMS_DESCRIPTOR_REGEX.test(raw)) {
      return {
        displayName: raw,
        descriptor: raw,
      };
    }

    // Azure Subject Descriptor: aad.xxx...
    if (SUBJECT_DESCRIPTOR_REGEX.test(raw) && !raw.includes('@')) {
      return {
        displayName: raw,
        descriptor: raw,
      };
    }

    // Raw GUID: 00000000-0000-0000-0000-000000000000
    if (GUID_REGEX.test(raw)) {
      return {
        displayName: raw,
        identityId: raw,
      };
    }

    // Plain Email / UPN: user@domain.com
    if (raw.includes('@')) {
      const result: ExtractedIdentity = {
        displayName: raw,
        uniqueName: raw,
      };
      Object.defineProperty(result, 'email', {
        get() { return raw; },
        enumerable: false,
        configurable: true,
      });
      return result;
    }

    // Plain Display Name
    return { displayName: raw };
  }

  return null;
}

/**
 * Checks if a work item's AssignedTo field matches a specific person configuration
 */
export function matchesPerson(assignedToVal: unknown, person: PersonConfig | Person): boolean {
  const identity = extractIdentity(assignedToVal);
  if (!identity) return false;

  const targetEmail = (person.assignedTo || '').toLowerCase().trim();
  const targetName = (person.name || '').toLowerCase().trim();
  const targetKey = (person.key || '').toLowerCase().trim();
  const targetGithub = (person.githubUsername || '').toLowerCase().trim();
  const targetAliases = Array.isArray(person.aliases)
    ? person.aliases.map(a => String(a).toLowerCase().trim()).filter(Boolean)
    : [];

  const candidateUnique = (identity.uniqueName || '').toLowerCase().trim();
  const candidateEmail = ((identity as any).email || (candidateUnique.includes('@') ? candidateUnique : '')).toLowerCase().trim();
  const candidateDisplay = (identity.displayName || '').toLowerCase().trim();
  const candidateDescriptor = ((identity as any).descriptor || '').toLowerCase().trim();
  const candidateId = ((identity as any).identityId || (identity as any).id || '').toLowerCase().trim();

  // 1. Authoritative direct identifier matches
  if (candidateUnique && candidateUnique === targetEmail) return true;
  if (candidateEmail && candidateEmail === targetEmail) return true;

  // 2. Target key / username / github matches
  if (candidateUnique && (candidateUnique === targetKey || candidateUnique === targetGithub)) return true;
  if (candidateEmail && (candidateEmail === targetKey || candidateEmail === targetGithub)) return true;

  // 3. Alias / Claims / Subject Descriptor / GUID matches
  if (targetAliases.length > 0) {
    if (candidateUnique && targetAliases.includes(candidateUnique)) return true;
    if (candidateEmail && targetAliases.includes(candidateEmail)) return true;
    if (candidateDescriptor && targetAliases.includes(candidateDescriptor)) return true;
    if (candidateId && targetAliases.includes(candidateId)) return true;
    if (candidateDisplay && targetAliases.includes(candidateDisplay)) return true;
  }

  // 4. Descriptor / IdentityId direct match on targetEmail or targetKey
  if (candidateDescriptor && (candidateDescriptor === targetEmail || candidateDescriptor === targetKey)) return true;
  if (candidateId && (candidateId === targetEmail || candidateId === targetKey)) return true;

  // 5. Display Name Evaluation with Collision Defense
  if (candidateDisplay && (candidateDisplay === targetName || candidateDisplay === targetEmail)) {
    // If the candidate identity provides an explicit email address (contains '@'),
    // and the target person also has a configured email address (contains '@'),
    // and they do NOT match and are not in targetAliases, prevent collision!
    const effectiveCandidateEmail = candidateEmail || (candidateUnique.includes('@') ? candidateUnique : '');
    const hasTargetEmail = targetEmail.includes('@');

    if (effectiveCandidateEmail && hasTargetEmail && effectiveCandidateEmail !== targetEmail && !targetAliases.includes(effectiveCandidateEmail)) {
      // Confirmed distinct email identity: Alex Employee vs Alex Contractor / Alex Attacker
      return false;
    }

    // Otherwise, exact display name matches without email collision
    return true;
  }

  // 6. Name matching uniqueName when person.assignedTo was configured as display name
  if (candidateUnique && candidateUnique === targetName) return true;

  return false;
}

/**
 * Normalizes an assignee identifier to a non-empty string or null.
 * Replaces empty strings and whitespace-only assignees with null.
 */
export function normalizeAssignee(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const val = obj.id || obj.descriptor || obj.uniqueName || obj.displayName;
    if (val && typeof val === 'string' && val.trim() !== '') return val.trim();
  }
  return null;
}

/**
 * Check if two identities match
 */
export function identitiesMatch(a: string, b: string): boolean {
  return normalizeIdentity(a) === normalizeIdentity(b);
}

/**
 * Validate person configuration
 */
export function validatePerson(person: PersonConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!person.key?.trim()) {
    errors.push('Person key is required');
  }
  if (!person.name?.trim()) {
    errors.push('Person name is required');
  }
  if (!person.assignedTo?.trim()) {
    errors.push('Person assignedTo (identity) is required');
  }
  if (person.githubRepositories !== undefined &&
      (!Array.isArray(person.githubRepositories) || person.githubRepositories.length > 12 ||
       person.githubRepositories.some(repo => {
         if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return true;
         return repo.split('/').some(segment => segment === '.' || segment === '..');
       }))) {
    errors.push('GitHub repositories must be up to 12 owner/repo names.');
  }
  if (person.githubBranches !== undefined &&
      (!Array.isArray(person.githubBranches) || person.githubBranches.length > 12 ||
       person.githubBranches.some(branch =>
         typeof branch !== 'string' || branch.length > 128 ||
         !/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')))) {
    errors.push('GitHub branches must be valid ref names (up to 12).');
  }
  if (person.enabled === false) {
    // Disabled persons are valid but skipped
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Person Entity - aggregate root for task operations
 */
export class Person {
  readonly key: string;
  readonly name: string;
  readonly assignedTo: string;
  readonly enabled: boolean;
  readonly autoCloseEnabled: boolean;
  readonly sourceTaskId?: number;
  readonly pod?: string;
  readonly role?: string;
  readonly titlePrefix?: string;
  readonly githubUsername?: string;
  readonly githubRepositories?: string[];
  readonly githubBranches?: string[];
  readonly aliases?: string[];
  readonly canonicalId?: string;

  constructor(config: PersonConfig) {
    const validation = validatePerson(config);
    if (!validation.valid) {
      throw new Error(`Invalid person config: ${validation.errors.join(', ')}`);
    }
    
    this.key = config.key;
    this.name = config.name;
    this.assignedTo = config.assignedTo;
    this.enabled = config.enabled ?? true;
    this.autoCloseEnabled = config.autoCloseEnabled !== false; // Defaults to true
    this.sourceTaskId = config.sourceTaskId;
    this.pod = config.pod;
    this.role = config.role;
    this.titlePrefix = config.titlePrefix;
    this.githubUsername = config.githubUsername;
    this.githubRepositories = config.githubRepositories;
    this.githubBranches = config.githubBranches;
    this.aliases = Array.isArray(config.aliases) ? [...config.aliases] : undefined;
    this.canonicalId = config.canonicalId;
  }

  /**
   * Check if this person matches a given identity
   */
  matchesIdentity(identity: unknown): boolean {
    return matchesPerson(identity, this) || (typeof identity === 'string' && identitiesMatch(this.assignedTo, identity));
  }

  /**
   * Get a unique identifier for this person in the context of a run
   */
  getRunKey(): string {
    return this.key;
  }

  toConfig(): PersonConfig {
    return {
      key: this.key,
      name: this.name,
      assignedTo: this.assignedTo,
      enabled: this.enabled,
      autoCloseEnabled: this.autoCloseEnabled,
      sourceTaskId: this.sourceTaskId,
      pod: this.pod,
      role: this.role,
      titlePrefix: this.titlePrefix,
      githubUsername: this.githubUsername,
      githubRepositories: this.githubRepositories,
      githubBranches: this.githubBranches,
      aliases: this.aliases ? [...this.aliases] : undefined,
      canonicalId: this.canonicalId,
    };
  }
}

/**
 * Returns all stable/configured identifiers for Azure WIQL prefiltering.
 * Display names remain useful but are never the only source of identity evidence.
 */
export function getPersonIdentityAliases(person: PersonConfig | Person): string[] {
  return Array.from(new Set([
    person.assignedTo,
    person.key,
    person.githubUsername,
    person.canonicalId,
    ...(Array.isArray(person.aliases) ? person.aliases : []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim())));
}

/**
 * Checks whether multiple configured people can match the same Azure identity.
 */
export function resolvePersonMatches(identity: unknown, people: Array<PersonConfig | Person>): Array<PersonConfig | Person> {
  return people.filter(person => matchesPerson(identity, person));
}

/**
 * Returns true if the given identity has an authoritative match with the person configuration.
 * Authoritative matches are based on unique identifiers (email, descriptor, identityId)
 * and take precedence over display name matches.
 */
export function hasAuthoritativePersonMatch(identity: unknown, person: PersonConfig | Person): boolean {
  const extracted = extractIdentity(identity);
  if (!extracted) return false;
  const aliases = getPersonIdentityAliases(person).map(normalizeIdentity);
  const candidates = [
    extracted.uniqueName,
    (extracted as any).email,
    extracted.descriptor,
    extracted.identityId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeIdentity);
  return candidates.some(candidate => aliases.includes(candidate));
}