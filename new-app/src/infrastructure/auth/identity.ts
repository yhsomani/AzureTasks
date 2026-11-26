/**
 * Production Identity Attribution & Audit Helpers.
 * Provides operator email sanitization, resolution, and immutable journal container.
 */

/**
 * Sanitize operator email: trim, lowercase, validate non-empty.
 */
export function sanitizeOperatorEmail(raw?: string): string {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Operator identity required for audit compliance.');
  }
  return raw.trim().toLowerCase();
}

/**
 * Resolve operator identity strictly prioritizing verified JWT identity over spoofed headers.
 */
export function resolveOperator(
  user?: { email?: string } | string,
  _untrustedHeaderEmail?: string
): string {
  let email: string | undefined;
  if (typeof user === 'string') {
    email = user;
  } else if (user && typeof user.email === 'string') {
    email = user.email;
  }
  if (email && email.trim()) {
    return sanitizeOperatorEmail(email);
  }
  throw new Error('Operator identity required for audit compliance.');
}

/**
 * Immutable journal record container.
 */
export class ImmutableJournalEntry {
  readonly id: string;
  readonly operatorEmail: string;

  constructor(id: string, operatorEmail: string) {
    this.id = id;
    this.operatorEmail = sanitizeOperatorEmail(operatorEmail);
    Object.freeze(this);
  }
}
