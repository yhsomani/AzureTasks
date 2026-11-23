/**
 * Get Test Health Use Case
 * 
 * Retrieves test execution counts, pass/fail metrics, and success rates across projects.
 */

import {
  IAzureDataRepository,
  TestHealthRecord,
} from '../../../domain/ports/azure-data-repository.js';

export class GetTestHealthUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(): Promise<TestHealthRecord[]> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    return this.repo.getTestHealth();
  }
}
