export type UserRole = 'Admin' | 'Lead' | 'Developer' | 'Auditor';

export interface MockUserPersona {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  tenantId: string;
  teamId: string;
}

export interface MockTenant {
  id: string;
  name: string;
  slug: string;
  departments: Array<{
    id: string;
    name: string;
    teams: Array<{
      id: string;
      name: string;
      members: string[];
    }>;
  }>;
}

export const SEED_PERSONAS: Record<string, MockUserPersona> = {
  admin: {
    id: 'user-admin-01',
    email: 'admin@workops.test',
    displayName: 'System Admin',
    role: 'Admin',
    tenantId: 'tenant-enterprise-01',
    teamId: 'team-platform-01',
  },
  lead: {
    id: 'user-lead-01',
    email: 'lead@workops.test',
    displayName: 'Tech Lead',
    role: 'Lead',
    tenantId: 'tenant-enterprise-01',
    teamId: 'team-core-01',
  },
  developer: {
    id: 'user-dev-01',
    email: 'dev1@workops.test',
    displayName: 'Dev One',
    role: 'Developer',
    tenantId: 'tenant-enterprise-01',
    teamId: 'team-core-01',
  },
  auditor: {
    id: 'user-auditor-01',
    email: 'auditor@workops.test',
    displayName: 'Compliance Auditor',
    role: 'Auditor',
    tenantId: 'tenant-enterprise-01',
    teamId: 'team-governance-01',
  },
};

export const SEED_TENANTS: MockTenant[] = [
  {
    id: 'tenant-enterprise-01',
    name: 'WorkOps Enterprise',
    slug: 'workops-ent',
    departments: [
      {
        id: 'dept-engineering',
        name: 'Engineering',
        teams: [
          {
            id: 'team-core-01',
            name: 'Core Platform',
            members: ['user-lead-01', 'user-dev-01'],
          },
          {
            id: 'team-governance-01',
            name: 'Governance & Security',
            members: ['user-auditor-01'],
          },
        ],
      },
    ],
  },
  {
    id: 'tenant-external-02',
    name: 'External Partner Org',
    slug: 'external-partner',
    departments: [
      {
        id: 'dept-contractors',
        name: 'Contractors',
        teams: [
          {
            id: 'team-partner-alpha',
            name: 'Partner Alpha',
            members: ['user-partner-01'],
          },
        ],
      },
    ],
  },
];
