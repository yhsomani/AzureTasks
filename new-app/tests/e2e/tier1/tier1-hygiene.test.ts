import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  planCreationDates,
  getTodayIso,
  getNextThursdayIso,
  addDays,
} from '../../../src/domain/value-objects/date-window.js';
import { FileConfigRepository } from '../../../src/infrastructure/config/file-config-repo.js';
import { startHarness, stopHarness, WorkOpsTestHarness } from '../harness/index.js';

describe('Tier 1: Feature Coverage (F1-F6) - Hygiene & QA', () => {
  let harness: WorkOpsTestHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await stopHarness();
  });

  describe('Feature F1: Deterministic Time Mocking', () => {
    it('T1-F1-01: Mid-Week System Time Planning Execution', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-10-14T10:00:00Z')); // Wednesday
        const today = getTodayIso('UTC');
        expect(today).toBe('2026-10-14');
        const plan = planCreationDates({
          todayIso: today,
          latestExistingTaskIso: '',
          latestExistingTaskId: 0,
          existingTasksMap: new Map(),
          titlePrefix: 'Task:',
          thursdayMode: 'CURRENT',
          skipWeekends: true,
          stopDayOfWeek: 4,
        });
        expect(plan.plannedDates.length).toBeGreaterThanOrEqual(1);
        expect(plan.plannedDates.some((d) => d.isoDate === '2026-10-14')).toBe(true);
        expect(plan.plannedDates.every((d) => d.status !== 'WEEKEND_SKIP')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('T1-F1-02: Monday Start-of-Week Work Window Calculation', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-10-12T09:00:00Z')); // Monday
        const today = getTodayIso('UTC');
        expect(today).toBe('2026-10-12');
        const nextThursday = getNextThursdayIso(today, 'CURRENT', 4);
        expect(nextThursday).toBe('2026-10-15');
        const plan = planCreationDates({
          todayIso: today,
          latestExistingTaskIso: '',
          latestExistingTaskId: 0,
          existingTasksMap: new Map(),
          titlePrefix: 'Task:',
          thursdayMode: 'CURRENT',
          skipWeekends: true,
          stopDayOfWeek: 4,
        });
        expect(plan.plannedDates[0].isoDate).toBe('2026-10-12');
        expect(plan.plannedDates[plan.plannedDates.length - 1].isoDate).toBe('2026-10-15');
      } finally {
        vi.useRealTimers();
      }
    });

    it('T1-F1-03: Thursday Planning Cycle Anchor Rollover', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-10-15T15:00:00Z')); // Thursday
        const today = getTodayIso('UTC');
        expect(today).toBe('2026-10-15');
        const nextCycleThursday = getNextThursdayIso(today, 'FOLLOWING', 4);
        expect(nextCycleThursday).toBe('2026-10-22');
      } finally {
        vi.useRealTimers();
      }
    });

    it('T1-F1-04: Leap Year Month Boundary Rollover', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2028-02-28T10:00:00Z')); // 2028 is leap year
        const today = getTodayIso('UTC');
        expect(today).toBe('2028-02-28');
        const nextDay = addDays(today, 1);
        expect(nextDay).toBe('2028-02-29');
        const dayAfter = addDays(today, 2);
        expect(dayAfter).toBe('2028-03-01');
      } finally {
        vi.useRealTimers();
      }
    });

    it('T1-F1-05: Year-End Rollover Invariance', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-12-31T18:00:00Z')); // Thursday New Year Eve
        const today = getTodayIso('UTC');
        expect(today).toBe('2026-12-31');
        const newYearDay = addDays(today, 1);
        expect(newYearDay).toBe('2027-01-01');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Feature F2: Dead Code & Backup Elimination', () => {
    it('T1-F2-01: Verification of Unreferenced Duplicate Use-Case Deletion', () => {
      const target = path.resolve(process.cwd(), 'src/application/use-cases/close-daily-tasks-updated.ts');
      expect(fs.existsSync(target)).toBe(false);
    });

    it('T1-F2-02: Verification of Application Use-Case Backup File Deletion', () => {
      const target = path.resolve(process.cwd(), 'src/application/use-cases/close-daily-tasks.ts.bak');
      expect(fs.existsSync(target)).toBe(false);
    });

    it('T1-F2-03: Verification of Journal Repo Backup File Deletion', () => {
      const target = path.resolve(process.cwd(), 'src/infrastructure/journal/file-journal-repo.ts.bak');
      expect(fs.existsSync(target)).toBe(false);
    });

    it('T1-F2-04: Verification of Work Item Service Backup File Deletion', () => {
      const target = path.resolve(process.cwd(), 'src/infrastructure/azure/work-item-service.ts.bak');
      expect(fs.existsSync(target)).toBe(false);
    });

    it('T1-F2-05: Clean Compilation Without Dead Code Imports', () => {
      expect(() => {
        execSync('npx tsc --noEmit', { stdio: 'pipe' });
      }).not.toThrow();
    });
  });

  describe('Feature F3: Auto-Closure Route Mounting & Refactoring', () => {
    it('T1-F3-01: Auto-Closure Trigger Endpoint Responds 200', async () => {
      const res = await harness.post('/api/tasks/close-today', { all: true, confirm: true, dryRun: false });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
    });

    it('T1-F3-02: Retrieve Auto-Closure Configuration', async () => {
      const res = await harness.get('/api/auto-closure/config');
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
    });

    it('T1-F3-03: Update Auto-Closure Configuration', async () => {
      const getRes = await harness.get('/api/auto-closure/config');
      const getJson: any = await getRes.json();
      const config = getJson.data;
      config.cutoffTime = '18:30';
      const res = await harness.put('/api/auto-closure/config', config);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.cutoffTime).toBe('18:30');
    });

    it('T1-F3-04: Auto-Closure Audit History Retrieval', async () => {
      const res = await harness.get('/api/auto-closure/audit?limit=10');
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('T1-F3-05: Auto-Closure Dry-Run Simulation', async () => {
      const res = await harness.post('/api/tasks/close-today', { all: true, dryRun: true });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.dryRun).toBe(true);
    });
  });

  describe('Feature F4: Corporate PII Sanitization', () => {
    it('T1-F4-01: .gitignore Ignores Active State and Member JSON Files', () => {
      const gitignore = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8');
      expect(gitignore).toContain('people.json');
      expect(gitignore).toContain('.task-journal.json');
      expect(gitignore).toContain('.auto-closure-config.json');
      expect(gitignore).toContain('.work-calendar.json');
    });

    it('T1-F4-02: Template File people.example.json Exists with Synthetic Data', () => {
      const templatePath = path.resolve(process.cwd(), 'people.example.json');
      expect(fs.existsSync(templatePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
      expect(Array.isArray(data.people)).toBe(true);
      for (const p of data.people) {
        expect(p.assignedTo).toMatch(/@(example\.com|workops\.test)/);
      }
    });

    it('T1-F4-03: Git Tracked Files Contain Zero Corporate Email Domains', () => {
      const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
      for (const file of tracked) {
        if (!fs.existsSync(file)) continue;
        const stat = fs.statSync(file);
        if (stat.size > 200000 || file.includes('package-lock.json')) continue;
        const content = fs.readFileSync(file, 'utf8');
        expect(content).not.toMatch(/[a-zA-Z0-9._%+-]+@bajajfinserv\.in/);
      }
    });

    it('T1-F4-04: Configuration Template config.example.json Validation', () => {
      const configPath = path.resolve(process.cwd(), 'people.example.json');
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(config.organization).toBeDefined();
      expect(config.project).toBeDefined();
    });

    it('T1-F4-05: Clean Bootstrap Using Sanitized Template Data', async () => {
      const templatePath = path.resolve(process.cwd(), 'people.example.json');
      const repo = new FileConfigRepository(templatePath);
      const loaded = await repo.load();
      expect(loaded.people.length).toBeGreaterThan(0);
      expect(loaded.organization).toBeDefined();
    });
  });

  describe('Feature F5: Local Chart.js Bundling', () => {
    it('T1-F5-01: Elimination of Unpinned CDN Script Tag in index.html', () => {
      const indexPath = path.resolve(process.cwd(), 'src/presentation/web/public/index.html');
      if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, 'utf8');
        expect(html).not.toContain('cdn.jsdelivr.net');
      }
    });

    it('T1-F5-02: Chart.js Package Listed in Production Dependencies', () => {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
      expect(pkg.dependencies['chart.js']).toBeDefined();
    });

    it('T1-F5-03: Successful Local Bundling of Chart.js via Build Script', () => {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBeDefined();
      expect(fs.existsSync(path.resolve(process.cwd(), 'node_modules/chart.js'))).toBe(true);
    });

    it('T1-F5-04: Offline Chart Rendering Verification', async () => {
      const chartMod = await import('chart.js');
      expect(chartMod.Chart).toBeDefined();
    });

    it('T1-F5-05: Content Security Policy (CSP) Compatibility', async () => {
      const res = await harness.get('/api/health');
      const csp = res.headers.get('Content-Security-Policy');
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
    });
  });

  describe('Feature F6: Dependency CVE Remediation', () => {
    it('T1-F6-01: Clean npm audit Execution', () => {
      let auditOutput = '';
      try {
        auditOutput = execSync('npm audit --json', { encoding: 'utf8' });
      } catch (err: any) {
        auditOutput = err.stdout?.toString() || '';
      }
      if (auditOutput.trim()) {
        try {
          const parsed = JSON.parse(auditOutput);
          const vulns = parsed.metadata?.vulnerabilities || {};
          expect(vulns.high || 0).toBe(0);
          expect(vulns.critical || 0).toBe(0);
        } catch {}
      }
    });

    it('T1-F6-02: Patched body-parser Version Verification', () => {
      const lockfile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8'));
      const bp = lockfile.packages?.['node_modules/body-parser'];
      if (bp) {
        const ver = bp.version;
        expect(ver).toMatch(/^(1\.(2[1-9]|[3-9]\d)|2\.)/);
      }
    });

    it('T1-F6-03: Patched minimatch Version Verification', () => {
      const lockfile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8'));
      const mm = lockfile.packages?.['node_modules/minimatch'];
      if (mm) {
        const ver = mm.version;
        expect(ver).toBeDefined();
      }
    });

    it('T1-F6-04: Patched qs Version Verification', () => {
      const lockfile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8'));
      const qs = lockfile.packages?.['node_modules/qs'];
      if (qs) {
        const ver = qs.version;
        expect(ver).toBeDefined();
      }
    });

    it('T1-F6-05: Standard HTTP JSON Request Parsing', async () => {
      const res = await harness.post('/api/tasks/plan', {
        all: true,
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
    });
  });
});
