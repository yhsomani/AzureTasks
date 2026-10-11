/**
 * Person Entity and Value Objects
 * Core domain model for team members
 */

export interface PersonConfig {
  key: string;           // Stable person key (e.g. "person1")
  name: string;          // Display name
  assignedTo: string;    // Email, UPN, displayName, or identity descriptor
  enabled?: boolean;     // Defaults to true
  sourceTaskId?: number; // Optional per-person source work item override
  pod?: string;          // Team or POD name
  role?: string;         // Role in the company
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

/**
 * Extracts normalized identity details from an Azure DevOps AssignedTo field value
 */
export function extractIdentity(assignedToVal: unknown): { displayName: string; uniqueName?: string } | null {
  if (!assignedToVal) return null;
  if (typeof assignedToVal === 'object' && assignedToVal !== null) {
    const obj = assignedToVal as Record<string, unknown>;
    const displayName = String(obj.displayName || obj.name || '').trim();
    const uniqueName = obj.uniqueName ? String(obj.uniqueName).trim() : undefined;
    return { displayName, uniqueName };
  }
  if (typeof assignedToVal === 'string') {
    const raw = assignedToVal.trim();
    const emailMatch = raw.match(/<([^>]+)>/);
    if (emailMatch) {
      return { displayName: raw.replace(/<[^>]+>/, '').trim(), uniqueName: emailMatch[1].trim() };
    }
    if (raw.includes('@')) {
      return { displayName: raw, uniqueName: raw };
    }
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

  const targetEmail = person.assignedTo.toLowerCase().trim();
  const targetName = person.name.toLowerCase().trim();

  if (identity.uniqueName) {
    const identityEmail = identity.uniqueName.toLowerCase().trim();
    if (identityEmail === targetEmail) return true;
  }

  if (identity.displayName) {
    const identityDisplay = identity.displayName.toLowerCase().trim();
    if (identityDisplay === targetName || identityDisplay === targetEmail) return true;
    if (identityDisplay.includes(targetName) && targetName.length >= 3) return true;
  }

  return false;
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
  readonly sourceTaskId?: number;
  readonly pod?: string;
  readonly role?: string;

  constructor(config: PersonConfig) {
    const validation = validatePerson(config);
    if (!validation.valid) {
      throw new Error(`Invalid person config: ${validation.errors.join(', ')}`);
    }
    
    this.key = config.key;
    this.name = config.name;
    this.assignedTo = config.assignedTo;
    this.enabled = config.enabled ?? true;
    this.sourceTaskId = config.sourceTaskId;
    this.pod = config.pod;
    this.role = config.role;
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
      sourceTaskId: this.sourceTaskId,
      pod: this.pod,
      role: this.role,
    };
  }
}