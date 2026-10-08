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
  matchesIdentity(identity: string): boolean {
    return identitiesMatch(this.assignedTo, identity);
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