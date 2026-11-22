/**
 * Domain Models for Multi-Tenant Enterprise Hierarchy
 * Organizations -> Departments -> Teams -> Members
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
}

export interface Team {
  id: string;
  deptId: string;
  name: string;
  createdAt: string;
}

export interface Member {
  id: string;
  teamId: string;
  email: string;
  displayName: string;
  role: 'Admin' | 'Lead' | 'Developer' | 'Auditor';
  createdAt: string;
}

export interface TenantContext {
  organizationId: string;
  departmentId?: string;
  teamId?: string;
  slug?: string;
}

export function validateTenantHierarchy(
  org: Organization,
  dept: Department,
  team: Team,
  member?: Member
): { isValid: boolean; error?: string } {
  if (!org.id || !org.name || !org.slug) {
    return { isValid: false, error: 'Invalid organization attributes' };
  }
  if (dept.orgId !== org.id) {
    return { isValid: false, error: `Department ${dept.id} does not belong to organization ${org.id}` };
  }
  if (team.deptId !== dept.id) {
    return { isValid: false, error: `Team ${team.id} does not belong to department ${dept.id}` };
  }
  if (member && member.teamId !== team.id) {
    return { isValid: false, error: `Member ${member.id} does not belong to team ${team.id}` };
  }
  return { isValid: true };
}
