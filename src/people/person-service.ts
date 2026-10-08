/**
 * Person service for identity normalization, matching Azure DevOps assignees,
 * and filtering configured team members.
 */

import { PersonConfig } from '../config/config.js';

export interface AzureIdentitySummary {
  displayName: string;
  uniqueName?: string;
  id?: string;
}

/**
 * Extracts normalized identity details from an Azure DevOps AssignedTo field value
 */
export function extractIdentity(assignedToVal: unknown): AzureIdentitySummary | null {
  if (!assignedToVal) {
    return null;
  }

  // If assignedTo is an object (standard Azure DevOps REST API response)
  if (typeof assignedToVal === 'object' && assignedToVal !== null) {
    const obj = assignedToVal as Record<string, unknown>;
    const displayName = String(obj.displayName || obj.name || '').trim();
    const uniqueName = obj.uniqueName ? String(obj.uniqueName).trim() : undefined;
    const id = obj.id ? String(obj.id).trim() : undefined;

    return {
      displayName,
      uniqueName,
      id,
    };
  }

  // If assignedTo is a string: e.g. "John Doe <john@company.com>" or "john@company.com"
  if (typeof assignedToVal === 'string') {
    const raw = assignedToVal.trim();
    const emailMatch = raw.match(/<([^>]+)>/);
    if (emailMatch) {
      const uniqueName = emailMatch[1].trim();
      const displayName = raw.replace(/<[^>]+>/, '').trim();
      return { displayName, uniqueName };
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
export function matchesPerson(assignedToVal: unknown, person: PersonConfig): boolean {
  const identity = extractIdentity(assignedToVal);
  if (!identity) {
    return false;
  }

  const targetEmail = person.assignedTo.toLowerCase().trim();
  const targetName = person.name.toLowerCase().trim();

  // Match by uniqueName / email (exact or case-insensitive)
  if (identity.uniqueName) {
    const identityEmail = identity.uniqueName.toLowerCase().trim();
    if (identityEmail === targetEmail) {
      return true;
    }
  }

  // Match by displayName
  if (identity.displayName) {
    const identityDisplay = identity.displayName.toLowerCase().trim();
    if (identityDisplay === targetName || identityDisplay === targetEmail) {
      return true;
    }
    // Check if displayName contains name (e.g. "Yash Somani (BFL)" contains "Yash Somani")
    if (identityDisplay.includes(targetName) && targetName.length >= 3) {
      return true;
    }
  }

  return false;
}

/**
 * Selects which people to process based on CLI options (--person, --all)
 */
export function selectPeople(allPeople: PersonConfig[], options: { person?: string; all?: boolean }): PersonConfig[] {
  if (allPeople.length === 0) {
    throw new Error('No people configured in configuration. Please define at least one person in people.json.');
  }

  // If --all is passed, process every configured person
  // Filter out disabled people first (Section 3)
  const activePeople = allPeople.filter((p) => p.enabled !== false);
  if (activePeople.length === 0) {
    throw new Error('All configured people are disabled (enabled: false). Nothing to process.');
  }

  // If --all is passed, process every active configured person
  if (options.all) {
    return activePeople;
  }

  // If --person is specified (e.g. --person "Rahul" or --person "person1,person2")
  if (options.person) {
    const requestedNames = options.person
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0);

    const selected: PersonConfig[] = [];
    const missing: string[] = [];

    for (const req of requestedNames) {
      const found = activePeople.find(
        (p) =>
          (p.key && p.key.toLowerCase() === req) ||
          p.name.toLowerCase() === req ||
          p.assignedTo.toLowerCase() === req ||
          p.name.toLowerCase().includes(req)
      );

      if (found) {
        if (!selected.some((s) => s.assignedTo.toLowerCase() === found.assignedTo.toLowerCase())) {
          selected.push(found);
        }
      } else {
        missing.push(req);
      }
    }

    if (missing.length > 0) {
      const availableNames = activePeople
        .map((p) => `"${p.name}" (key: ${p.key || 'none'}, ${p.assignedTo})`)
        .join(', ');
      throw new Error(
        `Specified person(s) not found: ${missing.join(', ')}. Available enabled people: ${availableNames}`
      );
    }

    return selected;
  }

  // If only 1 person is active, default to that person
  if (activePeople.length === 1) {
    return activePeople;
  }

  // Otherwise, default to all active people
  return activePeople;
}
