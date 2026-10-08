import { describe, it, expect } from 'vitest';
import { PersonConfig } from '../src/config/config.js';
import {
  extractIdentity,
  matchesPerson,
  selectPeople,
} from '../src/people/person-service.js';

describe('Person Service — Identity & Selection', () => {
  const mockPeople: PersonConfig[] = [
    { name: 'Rahul Sharma', assignedTo: 'rahul@company.com' },
    { name: 'Priya Patel', assignedTo: 'priya@company.com' },
    { name: 'Amit Kumar', assignedTo: 'amit@company.com' },
  ];

  it('extracts identity from objects and strings correctly', () => {
    // Object format from Azure DevOps
    const objId = extractIdentity({
      displayName: 'Rahul Sharma',
      uniqueName: 'rahul@company.com',
      id: 'abc-123',
    });
    expect(objId?.displayName).toBe('Rahul Sharma');
    expect(objId?.uniqueName).toBe('rahul@company.com');

    // String with angle brackets
    const strBracket = extractIdentity('Rahul Sharma <rahul@company.com>');
    expect(strBracket?.displayName).toBe('Rahul Sharma');
    expect(strBracket?.uniqueName).toBe('rahul@company.com');

    // Plain email
    const plainEmail = extractIdentity('rahul@company.com');
    expect(plainEmail?.uniqueName).toBe('rahul@company.com');
  });

  it('matches work item assignee to person configuration accurately', () => {
    const rahul = mockPeople[0];

    expect(matchesPerson({ uniqueName: 'rahul@company.com' }, rahul)).toBe(true);
    expect(matchesPerson('Rahul Sharma <rahul@company.com>', rahul)).toBe(true);
    expect(matchesPerson('rahul@company.com', rahul)).toBe(true);
    expect(matchesPerson('Rahul Sharma', rahul)).toBe(true);
    expect(matchesPerson('priya@company.com', rahul)).toBe(false);
  });

  it('selects people according to CLI flags', () => {
    // --all selects everyone
    expect(selectPeople(mockPeople, { all: true })).toHaveLength(3);

    // --person "Rahul"
    const single = selectPeople(mockPeople, { person: 'Rahul' });
    expect(single).toHaveLength(1);
    expect(single[0].name).toBe('Rahul Sharma');

    // --person "Rahul,Priya"
    const multi = selectPeople(mockPeople, { person: 'Rahul,Priya' });
    expect(multi).toHaveLength(2);
    expect(multi.map((p) => p.name)).toEqual(['Rahul Sharma', 'Priya Patel']);

    // Unknown person throws descriptive error
    expect(() => selectPeople(mockPeople, { person: 'NonExistent' })).toThrow(
      /Specified person\(s\) not found: nonexistent/
    );
  });
});
