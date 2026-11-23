import { describe, it, expect } from 'vitest';
import { matchesPerson, extractIdentity, PersonConfig } from '../../src/domain/entities/person.js';

describe('Deterministic Canonical Identity Resolution', () => {
  const basePerson: PersonConfig = {
    key: 'yash_somani',
    name: 'Yash Somani',
    assignedTo: 'yash.somani@workops.test',
  };

  it('Scenario 1: Same person + same Azure ID and uniqueName -> matches', () => {
    const azureIdentity = {
      id: 'a269c33b-2b69-628e-a8eb-dbfc5f809fa2',
      displayName: 'Yash Somani',
      uniqueName: 'yash.somani@workops.test',
      descriptor: 'aad.YTI2OWMzM2ItMmI2OS03MjhlLWE4ZWItZGJmYzVmODA5ZmEy'
    };
    expect(matchesPerson(azureIdentity, basePerson)).toBe(true);
  });

  it('Scenario 2: Same person + email with casing differences -> matches', () => {
    const azureIdentity = {
      displayName: 'Yash Somani',
      uniqueName: 'YASH.SOMANI@WORKOPS.TEST',
    };
    expect(matchesPerson(azureIdentity, basePerson)).toBe(true);
  });

  it('Scenario 3: Same person + angle-bracket formatted string -> matches', () => {
    const rawString = 'Yash Somani <yash.somani@workops.test>';
    expect(matchesPerson(rawString, basePerson)).toBe(true);
  });

  it('Scenario 4: Same display name + different email/identity -> does NOT match (prevents silent collision)', () => {
    const differentPersonAzure = {
      displayName: 'Yash Somani',
      uniqueName: 'yash.somani.external@contractor.test',
    };
    expect(matchesPerson(differentPersonAzure, basePerson)).toBe(false);
  });

  it('Scenario 5: Missing uniqueName + exact display name fallback -> matches when identical', () => {
    const displayOnlyAzure = {
      displayName: 'Yash Somani',
    };
    expect(matchesPerson(displayOnlyAzure, basePerson)).toBe(true);
  });

  it('Scenario 6: Display name partial/substring collision -> does NOT match', () => {
    const partialMatch = {
      displayName: 'Yash Somani (External Consultant)',
    };
    expect(matchesPerson(partialMatch, basePerson)).toBe(false);
  });

  it('Scenario 7: Unassigned / null identity -> returns false and does not throw', () => {
    expect(matchesPerson(null, basePerson)).toBe(false);
    expect(matchesPerson(undefined, basePerson)).toBe(false);
    expect(matchesPerson('', basePerson)).toBe(false);
    expect(matchesPerson({}, basePerson)).toBe(false);
  });

  it('Scenario 8: extractIdentity extracts structured fields properly', () => {
    const raw = {
      displayName: '  Ajinkya Lendikar  ',
      uniqueName: '  ajinkya.lendikar@workops.test  ',
      id: 'guid-1234'
    };
    const extracted = extractIdentity(raw);
    expect(extracted).not.toBeNull();
    expect(extracted?.displayName).toBe('Ajinkya Lendikar');
    expect(extracted?.uniqueName).toBe('ajinkya.lendikar@workops.test');
  });
});
