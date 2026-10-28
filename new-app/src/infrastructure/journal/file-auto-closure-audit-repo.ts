/**
 * File-based Auto-Closure Audit Log Repository
 * Persists and retrieves auto-closure decisions with retention policies
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import {
  AutoClosureAuditLogRepository,
  AutoClosureAuditLog,
  AutoClosureAuditFilter,
} from '../../domain/ports/repositories.js';

const MAX_ENTRIES = 50000;

export class FileAutoClosureAuditRepository implements AutoClosureAuditLogRepository {
  private readonly auditPath: string;
  private readonly archiveDir: string;

  constructor(auditPath?: string) {
    this.auditPath = auditPath
      ? path.resolve(process.cwd(), auditPath)
      : path.resolve(process.cwd(), '.auto-closure-audit.json');
    this.archiveDir = path.join(path.dirname(this.auditPath), '.audit-archives');
  }

  async record(entry: AutoClosureAuditLog): Promise<void> {
    if (!entry.id) {
      entry.id = randomUUID();
    }

    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    const existing = this.readEntriesFrom(this.auditPath);
    await this.rotateIfNeeded(existing.length >= MAX_ENTRIES);
    const entries = this.readEntriesFrom(this.auditPath);
    entries.push(entry);
    this.writeEntriesAtomically(entries, this.auditPath);
  }

  async getEntries(
    limit?: number,
    filters?: AutoClosureAuditFilter
  ): Promise<AutoClosureAuditLog[]> {
    const entries = this.readEntriesFrom(this.auditPath).reverse();
    const max = limit && limit > 0 ? limit : Infinity;

    for (const archive of this.listArchiveFiles()) {
      if (entries.length >= max) break;
      entries.push(...this.readEntriesFrom(archive).reverse());
    }

    let filtered = entries.slice(0, max);

    if (filters) {
      filtered = filtered.filter(entry => {
        if (filters.taskId && entry.taskId !== filters.taskId) return false;
        if (filters.userId && entry.assignedUser !== filters.userId) return false;
        if (filters.status && entry.status !== filters.status) return false;
        if (filters.triggerSource && entry.triggerSource !== filters.triggerSource) return false;
        if (filters.startDate && entry.closedAt < filters.startDate) return false;
        if (filters.endDate && entry.closedAt > filters.endDate) return false;
        return true;
      });
    }

    return filtered;
  }

  async getEntriesByTask(taskId: number): Promise<AutoClosureAuditLog[]> {
    return this.getEntries(undefined, { taskId });
  }

  async getEntriesByUser(userId: string, limit?: number): Promise<AutoClosureAuditLog[]> {
    return this.getEntries(limit, { userId });
  }

  async exportCsv(): Promise<string> {
    const entries = await this.getEntries();

    const headers = [
      'Timestamp',
      'TaskId',
      'AssignedUser',
      'TriggerSource',
      'ClosureReason',
      'RuleId',
      'Status',
      'Error',
    ];

    const escapeCsv = (val: any): string => {
      if (val === undefined || val === null) return '""';
      const plain = String(val);
      const safe = /^(?:[=+@-]|\t|\r|\n)/.test(plain) ? "'" + plain : plain;
      const str = safe.replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = entries.map(e => [
      escapeCsv(e.closedAt),
      escapeCsv(e.taskId),
      escapeCsv(e.assignedUser),
      escapeCsv(e.triggerSource),
      escapeCsv(e.closureReason),
      escapeCsv(e.automationDetails.ruleId || ''),
      escapeCsv(e.status),
      escapeCsv(e.error || ''),
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  async exportJson(): Promise<string> {
    const entries = await this.getEntries();
    return JSON.stringify(entries, null, 2);
  }

  async cleanup(beforeDate: string): Promise<number> {
    const entries = this.readEntriesFrom(this.auditPath);
    const filtered = entries.filter(e => e.closedAt >= beforeDate);
    const deleted = entries.length - filtered.length;

    if (deleted > 0) {
      this.writeEntriesAtomically(filtered, this.auditPath);
    }

    // Also clean up archives
    let archiveDeleted = 0;
    for (const archive of this.listArchiveFiles()) {
      const archiveEntries = this.readEntriesFrom(archive);
      const archiveFiltered = archiveEntries.filter(e => e.closedAt >= beforeDate);
      const archiveCount = archiveEntries.length - archiveFiltered.length;
      archiveDeleted += archiveCount;

      if (archiveCount > 0) {
        if (archiveFiltered.length === 0) {
          fs.unlinkSync(archive);
        } else {
          this.writeEntriesAtomically(archiveFiltered, archive);
        }
      }
    }

    return deleted + archiveDeleted;
  }

  private readEntriesFrom(filename: string): AutoClosureAuditLog[] {
    if (!fs.existsSync(filename)) return [];
    try {
      const entries: unknown = JSON.parse(fs.readFileSync(filename, 'utf-8'));
      if (!Array.isArray(entries)) throw new Error('Expected an array of audit entries.');
      return entries as AutoClosureAuditLog[];
    } catch (error) {
      throw new Error(
        `Audit log at "${filename}" is unreadable or corrupt: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private writeEntriesAtomically(entries: AutoClosureAuditLog[], filename: string): void {
    const tempPath = `${filename}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), 'utf-8');
      fs.renameSync(tempPath, filename);
    } catch (err: any) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw new Error(`Failed to write audit log: ${err.message}`);
    }
  }

  private listArchiveFiles(): string[] {
    return fs.existsSync(this.archiveDir)
      ? fs.readdirSync(this.archiveDir)
          .filter(name => /^auto-closure-audit-.*\.json$/.test(name))
          .sort()
          .reverse()
          .map(name => path.join(this.archiveDir, name))
      : [];
  }

  private async rotateIfNeeded(shouldRotate: boolean): Promise<void> {
    if (!shouldRotate) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `auto-closure-audit-${timestamp}.json`;
    const archivePath = path.join(this.archiveDir, archiveName);

    if (fs.existsSync(this.auditPath)) {
      const entries = this.readEntriesFrom(this.auditPath);
      this.writeEntriesAtomically(entries, archivePath);
      fs.writeFileSync(this.auditPath, JSON.stringify([], null, 2), 'utf-8');
    }
  }
}
