import { describe, it, expect } from 'vitest';
import {
  createPersonKey,
  normalizeIdentity,
  matchesPerson,
  identitiesMatch,
  validatePerson,
  Person,
} from '../../src/domain/entities/person';

describe('person: identity handling', () => {
  it('creates a stable key from an identity', () => {
    expect(createPersonKey('Yash.Somani@BajajFinserv.in')).toBe('yash.somani@bajajfinserv.in');
    expect(createPersonKey('  John Doe  ')).toBe('john_doe');
  });

  it('normalizes identities by trim + lowercase', () => {
    expect(normalizeIdentity('  A@B.COM ')).toBe('a@b.com');
  });

  it('matches identities case-insensitively and ignoring whitespace', () => {
    expect(identitiesMatch(' A@B.com ', 'a@b.COM')).toBe(true);
    expect(identitiesMatch('a@b.com', 'c@d.com')).toBe(false);
    expect(identitiesMatch('a@b.com', 'a@b.co')).toBe(false);
  });

  it('rejects cross-domain, substring and same-local-part identity collisions', () => {
    const person = { key: 'member', name: 'Alex Employee', assignedTo: 'alex@company.example' };
    expect(matchesPerson({ uniqueName: 'alex@evil.example', displayName: 'Alex Employee' }, person)).toBe(false);
    expect(matchesPerson('Alex Employee (contractor)', person)).toBe(false);
    expect(matchesPerson('alex@company.example.evil.example', person)).toBe(false);
    expect(matchesPerson('alex@company.example', person)).toBe(true);
    expect(matchesPerson({ uniqueName: 'ALEX@company.example', displayName: 'Someone' }, person)).toBe(true);
    expect(matchesPerson({ displayName: 'Alex Employee' }, person)).toBe(true);
  });

  it('does not partially match domains', () => {
    expect(identitiesMatch('user@b.com', 'user@b.com.evil.com')).toBe(false);
  });
});

describe('person: validation', () => {
  it('accepts a complete person', () => {
    const result = validatePerson({ key: 'p1', name: 'A', assignedTo: 'a@b.com' });
    expect(result.valid).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(validatePerson({ key: '', name: '', assignedTo: '' }).valid).toBe(false);
  });
});

describe('person: Person entity', () => {
  it('constructs and defaults enabled to true', () => {
    const p = new Person({ key: 'p1', name: 'A', assignedTo: 'a@b.com' });
    expect(p.enabled).toBe(true);
    expect(p.toConfig().assignedTo).toBe('a@b.com');
  });

  it('preserves explicit disabled flag', () => {
    const p = new Person({ key: 'p1', name: 'A', assignedTo: 'a@b.com', enabled: false });
    expect(p.enabled).toBe(false);
  });

  it('matches identity case-insensitively', () => {
    const p = new Person({ key: 'p1', name: 'A', assignedTo: 'A@B.com' });
    expect(p.matchesIdentity('a@b.COM')).toBe(true);
  });

  it('throws on invalid config', () => {
    expect(() => new Person({ key: '', name: '', assignedTo: '' })).toThrow();
  });
});
