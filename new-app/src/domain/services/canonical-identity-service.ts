/**
 * Canonical Identity Service
 * Resolves multi-format identity inputs (emails, aliases, claims descriptors, GUIDs)
 * to canonical person records and produces system identity diagnostics.
 */

import { extractIdentity } from '../entities/person.js';

export interface CanonicalIdentity {
  id: string;
  canonicalEmail: string;
  displayName: string;
  primaryUsername?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface IdentityDiagnostics {
  totalIdentities: number;
  totalAliases: number;
  unresolvedCount: number;
  mappings: Array<{
    id?: string;
    canonicalId: string;
    canonicalEmail: string;
    displayName: string;
    aliases: Array<{ type: string; value: string }>;
  }>;
}

export class CanonicalIdentityService {
  constructor(private readonly db: any) {}

  private getSqlite(): any {
    if (!this.db) return null;
    if (this.db.sqlite) return this.db.sqlite;
    if (typeof this.db.prepare === 'function') return this.db;
    return null;
  }

  public async resolveIdentity(rawIdentifier: string): Promise<CanonicalIdentity | null> {
    if (!rawIdentifier || typeof rawIdentifier !== 'string' || !rawIdentifier.trim()) {
      return null;
    }
    const clean = rawIdentifier.trim();
    const lower = clean.toLowerCase();

    const extracted = extractIdentity(clean);
    const searchEmail = extracted?.uniqueName?.includes('@') ? extracted.uniqueName.toLowerCase() : (clean.includes('@') ? lower : null);
    const searchDisplay = extracted?.displayName ? extracted.displayName.toLowerCase() : lower;
    const searchDescriptor = extracted?.descriptor || (clean.startsWith('claims:') || clean.startsWith('vss:sid:') || clean.startsWith('aad.') ? clean : null);
    const searchId = extracted?.identityId || null;

    const sqlite = this.getSqlite();
    if (sqlite) {
      // 1. Check canonical_email (case-insensitive)
      let row = searchEmail
        ? sqlite
            .prepare('SELECT * FROM canonical_identities WHERE LOWER(canonical_email) = ? LIMIT 1')
            .get(searchEmail)
        : null;

      // 2. Check canonical ID directly
      if (!row) {
        row = sqlite
          .prepare('SELECT * FROM canonical_identities WHERE id = ? OR LOWER(id) = ? LIMIT 1')
          .get(clean, lower);
      }

      // 3. Check identity_aliases (case-insensitive for emails/usernames, exact for descriptors/GUIDs)
      if (!row) {
        const aliasCandidates = [clean, lower];
        if (searchDescriptor) aliasCandidates.push(searchDescriptor);
        if (searchId) aliasCandidates.push(searchId);
        if (searchEmail) aliasCandidates.push(searchEmail);

        for (const cand of aliasCandidates) {
          row = sqlite
            .prepare(`
              SELECT c.* FROM canonical_identities c
              JOIN identity_aliases a ON a.canonical_id = c.id
              WHERE a.alias_value = ? OR LOWER(a.alias_value) = LOWER(?)
              LIMIT 1
            `)
            .get(cand, cand);
          if (row) break;
        }
      }

      // 4. Check display_name exact match fallback
      if (!row && searchDisplay) {
        row = sqlite
          .prepare('SELECT * FROM canonical_identities WHERE LOWER(display_name) = ? LIMIT 1')
          .get(searchDisplay);
      }

      if (!row) return null;

      return {
        id: row.id,
        canonicalEmail: row.canonical_email || row.canonicalEmail,
        displayName: row.display_name || row.displayName,
        primaryUsername: row.primary_username || row.primaryUsername || null,
        avatarUrl: row.avatar_url || row.avatarUrl || null,
        isActive: row.is_active === 1 || row.is_active === true || row.isActive === true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    // Postgres fallback
    if (this.db?.pool) {
      const client = this.db.pool;
      let res = searchEmail
        ? await client.query('SELECT * FROM canonical_identities WHERE LOWER(canonical_email) = $1 LIMIT 1', [searchEmail])
        : { rows: [] };
      if (res.rows.length === 0) {
        res = await client.query('SELECT * FROM canonical_identities WHERE id = $1 LIMIT 1', [clean]);
      }
      if (res.rows.length === 0) {
        res = await client.query(
          `SELECT c.* FROM canonical_identities c
           JOIN identity_aliases a ON a.canonical_id = c.id
           WHERE a.alias_value = $1 OR LOWER(a.alias_value) = LOWER($1)
           LIMIT 1`,
          [clean]
        );
      }
      if (res.rows.length === 0 && searchDisplay) {
        res = await client.query('SELECT * FROM canonical_identities WHERE LOWER(display_name) = $1 LIMIT 1', [searchDisplay]);
      }
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        canonicalEmail: row.canonical_email,
        displayName: row.display_name,
        primaryUsername: row.primary_username,
        avatarUrl: row.avatar_url,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    return null;
  }

  public async resolveOrRegister(raw: unknown): Promise<CanonicalIdentity> {
    const extracted = extractIdentity(raw);
    if (!extracted) {
      throw new Error('Cannot register empty or invalid identity.');
    }

    // Try resolving by email or descriptor or ID or name
    const query = extracted.uniqueName || extracted.email || extracted.descriptor || extracted.identityId || extracted.displayName;
    const existing = await this.resolveIdentity(query);
    if (existing) return existing;

    const email = (extracted.email || extracted.uniqueName || `${extracted.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_')}@workops.test`).toLowerCase();
    const memberKey = email.split('@')[0];
    const canonicalId = `usr_${memberKey}`;
    const nowIso = new Date().toISOString();

    const sqlite = this.getSqlite();
    if (sqlite) {
      sqlite
        .prepare(`
          INSERT OR REPLACE INTO canonical_identities (
            id, canonical_email, display_name, primary_username, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)
        `)
        .run(canonicalId, email, extracted.displayName, memberKey, nowIso, nowIso);

      const insertAlias = sqlite.prepare(`
        INSERT OR IGNORE INTO identity_aliases (id, canonical_id, identity_type, alias_value, is_verified, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `);

      insertAlias.run(`ia_${canonicalId}_email`, canonicalId, 'azure_email', email, nowIso);
      if (extracted.descriptor) {
        insertAlias.run(`ia_${canonicalId}_desc`, canonicalId, 'azure_descriptor', extracted.descriptor, nowIso);
      }
      if (extracted.identityId) {
        insertAlias.run(`ia_${canonicalId}_guid`, canonicalId, 'azure_guid', extracted.identityId, nowIso);
      }
      insertAlias.run(`ia_${canonicalId}_disp`, canonicalId, 'display_alias', extracted.displayName, nowIso);

      const registered = await this.resolveIdentity(canonicalId);
      if (!registered) throw new Error(`Failed to retrieve newly registered canonical identity ${canonicalId}`);
      return registered;
    }

    throw new Error('Database not configured for identity registration');
  }

  public async getDiagnostics(): Promise<IdentityDiagnostics> {
    const sqlite = this.getSqlite();
    if (sqlite) {
      const totalIdentities = sqlite.prepare('SELECT count(*) as c FROM canonical_identities').get().c;
      const totalAliases = sqlite.prepare('SELECT count(*) as c FROM identity_aliases').get().c;
      let unresolvedCount = 0;
      try {
        unresolvedCount = sqlite.prepare("SELECT count(*) as c FROM work_items WHERE assigned_identity_id IS NULL OR trim(assigned_identity_id) = ''").get().c;
      } catch {
        unresolvedCount = 0;
      }

      const identities = sqlite
        .prepare('SELECT id, canonical_email as canonicalEmail, display_name as displayName FROM canonical_identities ORDER BY display_name ASC')
        .all();

      const allAliases = sqlite
        .prepare('SELECT canonical_id as canonicalId, identity_type as type, alias_value as value FROM identity_aliases')
        .all();

      const aliasMap = new Map<string, Array<{ type: string; value: string }>>();
      for (const a of allAliases) {
        if (!aliasMap.has(a.canonicalId)) aliasMap.set(a.canonicalId, []);
        aliasMap.get(a.canonicalId)!.push({ type: a.type, value: a.value });
      }

      const mappings = identities.map((idRow: any) => ({
        id: idRow.id,
        canonicalId: idRow.id,
        canonicalEmail: idRow.canonicalEmail,
        displayName: idRow.displayName,
        aliases: aliasMap.get(idRow.id) || [],
      }));

      return {
        totalIdentities,
        totalAliases,
        unresolvedCount,
        mappings,
      };
    }

    if (this.db?.pool) {
      const client = this.db.pool;
      const idRes = await client.query('SELECT count(*) as c FROM canonical_identities');
      const aliasRes = await client.query('SELECT count(*) as c FROM identity_aliases');
      let unresolvedCount = 0;
      try {
        const unres = await client.query("SELECT count(*) as c FROM work_items WHERE assigned_identity_id IS NULL OR trim(assigned_identity_id) = ''");
        unresolvedCount = parseInt(unres.rows[0].c, 10);
      } catch {}

      const ids = await client.query('SELECT id, canonical_email as "canonicalEmail", display_name as "displayName" FROM canonical_identities ORDER BY display_name ASC');
      const aliases = await client.query('SELECT canonical_id as "canonicalId", identity_type as type, alias_value as value FROM identity_aliases');

      const aliasMap = new Map<string, Array<{ type: string; value: string }>>();
      for (const a of aliases.rows) {
        if (!aliasMap.has(a.canonicalId)) aliasMap.set(a.canonicalId, []);
        aliasMap.get(a.canonicalId)!.push({ type: a.type, value: a.value });
      }

      const mappings = ids.rows.map((row: any) => ({
        id: row.id,
        canonicalId: row.id,
        canonicalEmail: row.canonicalEmail,
        displayName: row.displayName,
        aliases: aliasMap.get(row.id) || [],
      }));

      return {
        totalIdentities: parseInt(idRes.rows[0].c, 10),
        totalAliases: parseInt(aliasRes.rows[0].c, 10),
        unresolvedCount,
        mappings,
      };
    }

    return {
      totalIdentities: 0,
      totalAliases: 0,
      unresolvedCount: 0,
      mappings: [],
    };
  }
}
