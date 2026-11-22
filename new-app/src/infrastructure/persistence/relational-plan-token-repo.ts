import { IPlanTokenRepository, PlanTokenRecord } from '../../domain/ports/repositories.js';
import { WorkOpsDb } from './database.js';

export class RelationalPlanTokenRepository implements IPlanTokenRepository {
  constructor(private readonly db: WorkOpsDb) {}

  async saveToken(record: PlanTokenRecord): Promise<void> {
    if (this.db.engine === 'sqlite') {
      const stmt = this.db.sqlite.prepare(`
        INSERT OR REPLACE INTO plan_tokens (
          token_hash, plan_token, expires_at, is_executed, snapshot_json, operator_email
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.tokenHash,
        record.planToken,
        record.expiresAt,
        record.isExecuted ? 1 : 0,
        record.snapshotJson,
        record.operatorEmail
      );
    } else {
      await this.db.pool.query(
        `
        INSERT INTO plan_tokens (
          token_hash, plan_token, expires_at, is_executed, snapshot_json, operator_email
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (token_hash) DO UPDATE SET
          plan_token = EXCLUDED.plan_token,
          expires_at = EXCLUDED.expires_at,
          is_executed = EXCLUDED.is_executed,
          snapshot_json = EXCLUDED.snapshot_json,
          operator_email = EXCLUDED.operator_email
      `,
        [
          record.tokenHash,
          record.planToken,
          record.expiresAt,
          record.isExecuted ? 1 : 0,
          record.snapshotJson,
          record.operatorEmail,
        ]
      );
    }
  }

  async getTokenByHash(tokenHash: string): Promise<PlanTokenRecord | null> {
    if (this.db.engine === 'sqlite') {
      const row = this.db.sqlite
        .prepare('SELECT * FROM plan_tokens WHERE token_hash = ?')
        .get(tokenHash) as any;

      if (!row) return null;
      return {
        tokenHash: row.token_hash,
        planToken: row.plan_token,
        expiresAt: Number(row.expires_at),
        isExecuted: Boolean(row.is_executed),
        snapshotJson: row.snapshot_json,
        operatorEmail: row.operator_email,
        createdAt: row.created_at,
      };
    } else {
      const res = await this.db.pool.query(
        'SELECT * FROM plan_tokens WHERE token_hash = $1',
        [tokenHash]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        tokenHash: row.token_hash,
        planToken: row.plan_token,
        expiresAt: Number(row.expires_at),
        isExecuted: Boolean(row.is_executed),
        snapshotJson: row.snapshot_json,
        operatorEmail: row.operator_email,
        createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      };
    }
  }

  async markExecuted(tokenHash: string): Promise<boolean> {
    if (this.db.engine === 'sqlite') {
      const res = this.db.sqlite
        .prepare('UPDATE plan_tokens SET is_executed = 1 WHERE token_hash = ?')
        .run(tokenHash);
      return res.changes > 0;
    } else {
      const res = await this.db.pool.query(
        'UPDATE plan_tokens SET is_executed = 1 WHERE token_hash = $1',
        [tokenHash]
      );
      return (res.rowCount ?? 0) > 0;
    }
  }
}
