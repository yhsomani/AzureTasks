import crypto from 'node:crypto';
import {
  JournalRepository,
  JournalEntry,
} from '../../domain/ports/repositories.js';
import { WorkOpsDb } from './database.js';
import { sanitizeOperatorEmail } from '../auth/identity.js';

export class RelationalJournalRepository implements JournalRepository {
  constructor(private readonly db: WorkOpsDb) {}

  async record(entry: JournalEntry): Promise<void> {
    const id = (entry as any).id || crypto.randomUUID();
    const actionType = entry.action || (entry as any).action_type || 'CREATED';
    const rawEmail = (entry as any).operator_email || entry.operatorEmail || entry.assignedTo;
    const operatorEmail = sanitizeOperatorEmail(rawEmail);
    const workItemId = entry.createdWorkItemId ?? entry.taskId ?? (entry as any).work_item_id ?? null;
    const detailsJson = JSON.stringify(entry);

    if (this.db.engine === 'sqlite') {
      const stmt = this.db.sqlite.prepare(`
        INSERT INTO journal_entries (
          id, run_id, team_id, operator_email, action_type, work_item_id,
          target_iso_date, title, field_copy_status, relation_copy_status,
          verified, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        entry.runId || null,
        (entry as any).teamId ?? null,
        operatorEmail,
        actionType,
        workItemId,
        entry.targetIsoDate ?? null,
        entry.title ?? null,
        entry.fieldCopyStatus ?? null,
        entry.relationCopyStatus ?? null,
        entry.verified ? 1 : 0,
        detailsJson,
        entry.timestamp || new Date().toISOString()
      );
    } else {
      await this.db.pool.query(
        `
        INSERT INTO journal_entries (
          id, run_id, team_id, operator_email, action_type, work_item_id,
          target_iso_date, title, field_copy_status, relation_copy_status,
          verified, details_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
        [
          id,
          entry.runId || null,
          (entry as any).teamId ?? null,
          operatorEmail,
          actionType,
          workItemId,
          entry.targetIsoDate ?? null,
          entry.title ?? null,
          entry.fieldCopyStatus ?? null,
          entry.relationCopyStatus ?? null,
          entry.verified ? 1 : 0,
          detailsJson,
          entry.timestamp || new Date().toISOString(),
        ]
      );
    }
  }

  async getEntries(limit?: number): Promise<JournalEntry[]> {
    const max = limit && limit > 0 ? limit : 1000;
    let rows: any[] = [];

    if (this.db.engine === 'sqlite') {
      rows = this.db.sqlite
        .prepare('SELECT * FROM journal_entries ORDER BY created_at DESC LIMIT ?')
        .all(max);
    } else {
      const res = await this.db.pool.query(
        'SELECT * FROM journal_entries ORDER BY created_at DESC LIMIT $1',
        [max]
      );
      rows = res.rows;
    }

    return rows.map((row) => {
      let details: any = {};
      try {
        details = JSON.parse(row.details_json);
      } catch {
        details = {};
      }
      return Object.freeze({
        ...details,
        id: row.id,
        action: row.action_type,
        actionType: row.action_type,
        operatorEmail: row.operator_email,
        operator_email: row.operator_email,
        workItemId: row.work_item_id,
        timestamp: row.created_at,
      });
    });
  }

  async getUnfinishedRelations(): Promise<JournalEntry[]> {
    const entries = await this.getEntries();
    return entries.filter(
      (e) =>
        e.createdWorkItemId != null &&
        (e.relationCopyStatus === 'PARTIAL' || e.relationCopyStatus === 'FAILED')
    );
  }

  async markRepaired(
    entry: JournalEntry,
    status: JournalEntry['relationCopyStatus'],
    note: string,
    verified = false
  ): Promise<boolean> {
    const entries = await this.getEntries();
    const target = entries.find(
      (e) =>
        e.runId === entry.runId &&
        e.timestamp === entry.timestamp &&
        e.createdWorkItemId === entry.createdWorkItemId
    );
    if (!target) return false;

    const updatedDetails = {
      ...target,
      relationCopyStatus: status,
      verified,
      error: note || target.error,
    };

    if (this.db.engine === 'sqlite') {
      const res = this.db.sqlite
        .prepare('UPDATE journal_entries SET details_json = ? WHERE id = ?')
        .run(JSON.stringify(updatedDetails), (target as any).id);
      return res.changes > 0;
    } else {
      const res = await this.db.pool.query(
        'UPDATE journal_entries SET details_json = $1 WHERE id = $2',
        [JSON.stringify(updatedDetails), (target as any).id]
      );
      return (res.rowCount ?? 0) > 0;
    }
  }

  async exportCsv(): Promise<string> {
    const entries = await this.getEntries();
    const headers = [
      'Timestamp',
      'RunId',
      'Action',
      'PersonName',
      'AssignedTo',
      'OperatorEmail',
      'TargetIsoDate',
      'Title',
      'SourceTaskId',
      'CreatedWorkItemId',
      'FieldStatus',
      'RelationStatus',
      'Verified',
      'Error',
    ];

    const escapeCsv = (val: any): string => {
      if (val === undefined || val === null) return '""';
      let plain = String(val);
      if (/^[=+\-@]/.test(plain)) plain = `'${plain}`;
      return `"${plain.replace(/"/g, '""')}"`;
    };

    const rows = entries.map((e) =>
      [
        e.timestamp,
        e.runId,
        e.action || 'CREATED',
        e.personName,
        e.assignedTo,
        e.operatorEmail || (e as any).operator_email || e.assignedTo || 'system',
        e.targetIsoDate,
        e.title,
        e.sourceTaskId,
        e.createdWorkItemId,
        e.fieldCopyStatus,
        e.relationCopyStatus,
        e.verified ? 'true' : 'false',
        e.error || '',
      ]
        .map(escapeCsv)
        .join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  async exportJson(): Promise<string> {
    const entries = await this.getEntries();
    return JSON.stringify(entries, null, 2);
  }
}
