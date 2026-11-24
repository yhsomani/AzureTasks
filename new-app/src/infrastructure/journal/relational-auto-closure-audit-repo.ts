/**
 * Relational Auto-Closure Audit Log Repository
 * Persists and retrieves auto-closure audit logs using relational database tables
 * (auto_closure_audit_logs).
 */

import crypto from 'node:crypto';
import {
  AutoClosureAuditLogRepository,
  AutoClosureAuditLog,
  AutoClosureAuditFilter,
} from '../../domain/ports/repositories.js';
import { WorkOpsDb } from '../persistence/database.js';

export class RelationalAutoClosureAuditRepository implements AutoClosureAuditLogRepository {
  constructor(private readonly db: WorkOpsDb) {}

  async record(entry: AutoClosureAuditLog): Promise<void> {
    if (!entry.id) {
      entry.id = crypto.randomUUID();
    }

    const id = entry.id;
    let ruleId: string | null = null;
    const candidateRuleId = entry.automationDetails?.ruleId;
    if (candidateRuleId) {
      if (this.db.engine === 'sqlite') {
        const ruleExists = this.db.sqlite.prepare('SELECT 1 FROM auto_closure_rules WHERE id = ?').get(candidateRuleId);
        if (ruleExists) ruleId = candidateRuleId;
      } else {
        const res = await this.db.pool.query('SELECT 1 FROM auto_closure_rules WHERE id = $1', [candidateRuleId]);
        if (res.rows.length > 0) ruleId = candidateRuleId;
      }
    }

    let canonicalId: string | null = null;
    if (entry.assignedUser) {
      const candidateCanonical = entry.assignedUser.startsWith('usr_')
        ? entry.assignedUser
        : `usr_${entry.assignedUser.split('@')[0]}`;
      if (this.db.engine === 'sqlite') {
        const userExists = this.db.sqlite.prepare('SELECT 1 FROM canonical_identities WHERE id = ?').get(candidateCanonical);
        if (userExists) canonicalId = candidateCanonical;
      } else {
        const res = await this.db.pool.query('SELECT 1 FROM canonical_identities WHERE id = $1', [candidateCanonical]);
        if (res.rows.length > 0) canonicalId = candidateCanonical;
      }
    }

    const taskId = entry.taskId;
    const projectId = null;
    const evaluationStatus = entry.status || 'success';
    const prEvidenceJson = JSON.stringify(entry.automationDetails || {});
    const decisionReason = entry.closureReason || 'Auto-closed';
    const operatorOverrideId = null;
    const evaluatedAt = entry.closedAt || new Date().toISOString();
    const detailsJson = JSON.stringify(entry);

    if (this.db.engine === 'sqlite') {
      this.db.sqlite.prepare(`
        INSERT INTO auto_closure_audit_logs (
          id, rule_id, task_id, project_id, canonical_id, evaluation_status,
          pr_evidence_json, decision_reason, operator_override_id, evaluated_at, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        ruleId,
        taskId,
        projectId,
        canonicalId,
        evaluationStatus,
        prEvidenceJson,
        decisionReason,
        operatorOverrideId,
        evaluatedAt,
        detailsJson
      );
    } else {
      await this.db.pool.query(`
        INSERT INTO auto_closure_audit_logs (
          id, rule_id, task_id, project_id, canonical_id, evaluation_status,
          pr_evidence_json, decision_reason, operator_override_id, evaluated_at, details_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        id,
        ruleId,
        taskId,
        projectId,
        canonicalId,
        evaluationStatus,
        prEvidenceJson,
        decisionReason,
        operatorOverrideId,
        evaluatedAt,
        detailsJson,
      ]);
    }
  }

  async getEntries(
    limit?: number,
    filters?: AutoClosureAuditFilter
  ): Promise<AutoClosureAuditLog[]> {
    const max = limit && limit > 0 ? limit : 10000;
    let rows: any[] = [];

    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.taskId) {
      if (this.db.engine === 'sqlite') {
        conditions.push('task_id = ?');
      } else {
        conditions.push(`task_id = $${params.length + 1}`);
      }
      params.push(filters.taskId);
    }

    if (filters?.status) {
      if (this.db.engine === 'sqlite') {
        conditions.push('evaluation_status = ?');
      } else {
        conditions.push(`evaluation_status = $${params.length + 1}`);
      }
      params.push(filters.status);
    }

    if (filters?.startDate) {
      if (this.db.engine === 'sqlite') {
        conditions.push('evaluated_at >= ?');
      } else {
        conditions.push(`evaluated_at >= $${params.length + 1}`);
      }
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      if (this.db.engine === 'sqlite') {
        conditions.push('evaluated_at <= ?');
      } else {
        conditions.push(`evaluated_at <= $${params.length + 1}`);
      }
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    if (this.db.engine === 'sqlite') {
      const sql = `SELECT * FROM auto_closure_audit_logs ${whereClause} ORDER BY evaluated_at DESC LIMIT ?`;
      rows = this.db.sqlite.prepare(sql).all(...params, max) as any[];
    } else {
      const sql = `SELECT * FROM auto_closure_audit_logs ${whereClause} ORDER BY evaluated_at DESC LIMIT $${params.length + 1}`;
      const res = await this.db.pool.query(sql, [...params, max]);
      rows = res.rows;
    }

    let entries: AutoClosureAuditLog[] = rows.map((r) => {
      if (r.details_json) {
        try {
          return JSON.parse(r.details_json);
        } catch {
          // fall through to row fields
        }
      }
      return {
        id: r.id,
        taskId: r.task_id,
        assignedUser: r.canonical_id || 'unknown',
        closedAt: r.evaluated_at,
        triggerSource: 'scheduled' as const,
        closureReason: r.decision_reason,
        automationDetails: {
          ruleId: r.rule_id || undefined,
        },
        configurationVersion: 1,
        validationResults: {
          passed: r.evaluation_status === 'success',
        },
        status: r.evaluation_status as any,
      };
    });

    if (filters?.userId) {
      entries = entries.filter((e) => e.assignedUser === filters.userId);
    }
    if (filters?.triggerSource) {
      entries = entries.filter((e) => e.triggerSource === filters.triggerSource);
    }

    return entries;
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

    const rows = entries.map((e) =>
      [
        escapeCsv(e.closedAt),
        escapeCsv(e.taskId),
        escapeCsv(e.assignedUser),
        escapeCsv(e.triggerSource),
        escapeCsv(e.closureReason),
        escapeCsv(e.automationDetails?.ruleId || ''),
        escapeCsv(e.status),
        escapeCsv(e.error || ''),
      ].join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  async exportJson(): Promise<string> {
    const entries = await this.getEntries();
    return JSON.stringify(entries, null, 2);
  }

  async cleanup(beforeDate: string): Promise<number> {
    if (this.db.engine === 'sqlite') {
      const res = this.db.sqlite
        .prepare('DELETE FROM auto_closure_audit_logs WHERE evaluated_at < ?')
        .run(beforeDate);
      return res.changes;
    } else {
      const res = await this.db.pool.query(
        'DELETE FROM auto_closure_audit_logs WHERE evaluated_at < $1',
        [beforeDate]
      );
      return res.rowCount ?? 0;
    }
  }
}
