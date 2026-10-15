/**
 * Get System Status Use Case
 * Returns current system health and configuration status
 */

import { WorkItemRepository, AppConfig, JournalRepository, SchedulerRepository } from '../../domain/ports/repositories.js';

export interface SystemStatusOutput {
  organization: string;
  project: string;
  baseUrl: string;
  connected: boolean;
  patConfigured: boolean;
  patMasked: string;
  projectValid: boolean;
  workItemTypeValid: boolean;
  timezone: string;
  thursdayMode: 'CURRENT' | 'FOLLOWING';
  errorMessage?: string;
}

export class GetSystemStatusUseCase {
  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly config: AppConfig,
    _journalRepo?: JournalRepository,
    _schedulerRepo?: SchedulerRepository
  ) {}

  async execute(): Promise<SystemStatusOutput> {
    const pat = process.env.AZURE_DEVOPS_PAT?.trim() || '';
    const patConfigured = pat.length > 0;
    const patMasked = patConfigured ? `${pat.slice(0, 4)}...${pat.slice(-4)}` : '';

    let connected = false;
    let projectValid = false;
    let workItemTypeValid = false;
    let errorMessage: string | undefined;

    if (patConfigured) {
      try {
        await this.workItemRepo.validateProject(this.config.project);
        projectValid = true;
        await this.workItemRepo.validateWorkItemType(this.config.project, this.config.workItemType);
        workItemTypeValid = true;
        connected = true;
      } catch (err: any) {
        connected = false;
        errorMessage = err.message || String(err);
      }
    } else {
      errorMessage = 'AZURE_DEVOPS_PAT is not configured.';
    }

    return {
      organization: this.config.organization,
      project: this.config.project,
      baseUrl: this.config.baseUrl,
      connected,
      patConfigured,
      patMasked,
      projectValid,
      workItemTypeValid,
      timezone: this.config.timezone,
      thursdayMode: this.config.thursdayMode,
      errorMessage,
    };
  }
}