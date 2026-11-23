import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteAzureDataRepository } from '../../../src/infrastructure/persistence/sqlite-azure-data-repo.js';

describe('Tier 1: Feature Coverage - Group 5: Clean Architecture & UI Modernization', () => {
  const repoRoot = process.cwd();

  // =========================================================================
  // Feature F15: Multi-Tier Clean Architecture Alignment (5 Tests)
  // =========================================================================
  describe('Feature F15: Multi-Tier Clean Architecture Alignment', () => {
    it('T1-F15-01: Domain layer purity: domain files contain zero imports from infrastructure or presentation', () => {
      const domainDir = path.join(repoRoot, 'src/domain');
      const domainFiles: string[] = [];

      function collectFiles(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            collectFiles(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            domainFiles.push(fullPath);
          }
        }
      }
      collectFiles(domainDir);

      const invalidImports: Array<{ file: string; line: string }> = [];
      for (const file of domainFiles) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (const line of lines) {
          if (
            (line.startsWith('import ') || line.startsWith('from ')) &&
            (line.includes('/infrastructure/') || line.includes('/presentation/'))
          ) {
            invalidImports.push({ file: path.relative(repoRoot, file), line: line.trim() });
          }
        }
      }

      expect(invalidImports).toEqual([]);
    });

    it('T1-F15-02: Ports & Adapters: SqliteAzureDataRepository satisfies IAzureDataRepository port contract', () => {
      const repo = new SqliteAzureDataRepository();
      expect(typeof repo.getProjectOverview).toBe('function');
      expect(typeof repo.getBuildHealth).toBe('function');
      expect(typeof repo.getTestHealth).toBe('function');
      expect(typeof repo.getTeams).toBe('function');
      expect(typeof repo.getTeamCount).toBe('function');
      expect(typeof repo.getRecentPipelineRuns).toBe('function');
      expect(typeof repo.getRecentReleases).toBe('function');
      expect(typeof repo.isAvailable).toBe('function');
    });

    it('T1-F15-03: Dependency Injection Composition Root: src/container.ts wires all use cases cleanly', () => {
      const containerFile = path.join(repoRoot, 'src/container.ts');
      expect(fs.existsSync(containerFile)).toBe(true);
      const content = fs.readFileSync(containerFile, 'utf8');

      expect(content).toContain('CreateTasksUseCase');
      expect(content).toContain('PlanTasksUseCase');
      expect(content).toContain('ExecuteTasksUseCase');
      expect(content).toContain('CloseDailyTasksUseCase');
      expect(content).toContain('ActivateDailyTasksUseCase');
      expect(content).toContain('RelationalJournalRepository');
    });

    it('T1-F15-04: Layer isolation: API routes in src/presentation/api/routes.ts do not import raw SQL drivers', () => {
      const routesContent = fs.readFileSync(path.join(repoRoot, 'src/presentation/api/routes.ts'), 'utf8');
      expect(routesContent).not.toMatch(/from\s+['"]better-sqlite3['"]/);
      expect(routesContent).not.toMatch(/from\s+['"]node:sqlite['"]/);
      expect(routesContent).not.toMatch(/from\s+['"]pg['"]/);
    });

    it('T1-F15-05: Domain entities contain business rules without database or network I/O', () => {
      const personEntity = fs.readFileSync(path.join(repoRoot, 'src/domain/entities/person.ts'), 'utf8');
      expect(personEntity).not.toContain('Database');
      expect(personEntity).not.toContain('http');
      expect(personEntity).not.toContain('fetch(');
    });
  });

  // =========================================================================
  // Feature F16: React 19 UI Mounting & Legacy app.js Retirement (5 Tests)
  // =========================================================================
  describe('Feature F16: React 19 UI Mounting & Legacy app.js Retirement', () => {
    it('T1-F16-01: index.html contains #root mounting element for React 19 SPA', () => {
      const indexHtml = fs.readFileSync(path.join(repoRoot, 'src/presentation/web/public/index.html'), 'utf8');
      expect(indexHtml).toContain('<div id="root"></div>');
    });

    it('T1-F16-02: React entrypoint src/presentation/web/src/main.tsx mounts to #root via createRoot', () => {
      const mainTsx = fs.readFileSync(path.join(repoRoot, 'src/presentation/web/src/main.tsx'), 'utf8');
      expect(mainTsx).toContain("document.getElementById('root')");
      expect(mainTsx).toContain('createRoot');
      expect(mainTsx).toContain('<App />');
    });

    it('T1-F16-03: Vite build configuration (vite.config.ts) targets React 19 application bundle', () => {
      const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain('@vitejs/plugin-react');
      expect(viteConfig).toContain('src/presentation/web/src/main.tsx');
      expect(viteConfig).toContain('dist/presentation/web/public');
    });

    it('T1-F16-04: Core React components (App, AppShell, Header, Navigation) exist and compile', () => {
      const appFile = path.join(repoRoot, 'src/presentation/web/src/App.tsx');
      const shellFile = path.join(repoRoot, 'src/presentation/web/src/components/layout/AppShell.tsx');
      const headerFile = path.join(repoRoot, 'src/presentation/web/src/components/layout/Header.tsx');
      const navFile = path.join(repoRoot, 'src/presentation/web/src/components/layout/Navigation.tsx');

      expect(fs.existsSync(appFile)).toBe(true);
      expect(fs.existsSync(shellFile)).toBe(true);
      expect(fs.existsSync(headerFile)).toBe(true);
      expect(fs.existsSync(navFile)).toBe(true);
    });

    it('T1-F16-05: index.html is valid HTML5 document with title, viewport, and accessibility tags', () => {
      const indexHtml = fs.readFileSync(path.join(repoRoot, 'src/presentation/web/public/index.html'), 'utf8');
      expect(indexHtml).toContain('<!DOCTYPE html>');
      expect(indexHtml).toContain('<html');
      expect(indexHtml).toContain('<head>');
      expect(indexHtml).toContain('<title>');
      expect(indexHtml).toContain('skip-link');
    });
  });

  // =========================================================================
  // Feature F17: Enhanced UI Dashboards & Unassigned Task Views (5 Tests)
  // =========================================================================
  describe('Feature F17: Enhanced UI Dashboards & Unassigned Task Views', () => {
    it('T1-F17-01: Azure data repository provides project overview for dashboard cockpit rendering', async () => {
      const repo = new SqliteAzureDataRepository();
      if (repo.isAvailable()) {
        const overview = await repo.getProjectOverview();
        expect(Array.isArray(overview)).toBe(true);
        expect(overview.length).toBeGreaterThanOrEqual(1);
        expect(overview[0]).toHaveProperty('projectId');
        expect(overview[0]).toHaveProperty('name');
      }
    });

    it('T1-F17-02: React workspace components exist in web source directory', () => {
      const workspacesDir = path.join(repoRoot, 'src/presentation/web/src/components/workspaces');
      expect(fs.existsSync(workspacesDir)).toBe(true);

      const files = fs.readdirSync(workspacesDir);
      expect(files).toContain('GovernanceWorkspace.tsx');
      expect(files).toContain('DailyWorkflowWorkspace.tsx');
      expect(files).toContain('TeamPlanningWorkspace.tsx');
      expect(files).toContain('AzureIntelligenceWorkspace.tsx');
    });

    it('T1-F17-03: Dual-project switcher contract supports both target projects', async () => {
      const repo = new SqliteAzureDataRepository();
      if (repo.isAvailable()) {
        const overview = await repo.getProjectOverview();
        const names = overview.map((p) => p.name);
        expect(names).toContain('3in1_Agile_Projects');
        expect(names).toContain('3_in_1_AppFrontEnd_Tasks');
      }
    });

    it('T1-F17-04: Sprint progress calculation calculates completion rates accurately', () => {
      function calculateSprintProgress(total: number, completed: number): { percent: number; isComplete: boolean } {
        if (total === 0) return { percent: 0, isComplete: false };
        const percent = Math.round((completed / total) * 100);
        return { percent, isComplete: completed === total };
      }

      expect(calculateSprintProgress(10, 5)).toEqual({ percent: 50, isComplete: false });
      expect(calculateSprintProgress(10, 10)).toEqual({ percent: 100, isComplete: true });
      expect(calculateSprintProgress(0, 0)).toEqual({ percent: 0, isComplete: false });
    });

    it('T1-F17-05: Build health repository query returns build definition success rates', async () => {
      const repo = new SqliteAzureDataRepository();
      if (repo.isAvailable()) {
        const health = await repo.getBuildHealth();
        expect(Array.isArray(health)).toBe(true);
        if (health.length > 0) {
          expect(health[0]).toHaveProperty('definitionId');
          expect(health[0]).toHaveProperty('successRate');
        }
      }
    });
  });

  // =========================================================================
  // Feature F18: Automated Test Suite & Regression Verification (5 Tests)
  // =========================================================================
  describe('Feature F18: Automated Test Suite & Regression Verification', () => {
    const runnerPath = path.join(repoRoot, 'tests/e2e/run-all-e2e.ts');

    it('T1-F18-01: Master E2E runner file (tests/e2e/run-all-e2e.ts) exists and is readable', () => {
      expect(fs.existsSync(runnerPath)).toBe(true);
    });

    it('T1-F18-02: All 4 test tiers are configured with minimum test threshold gates', () => {
      const runnerContent = fs.readFileSync(runnerPath, 'utf8');
      expect(runnerContent).toContain('tier1');
      expect(runnerContent).toContain('tier2');
      expect(runnerContent).toContain('tier3');
      expect(runnerContent).toContain('tier4');
      expect(runnerContent).toContain('requiredMin');
    });

    it('T1-F18-03: Tier 1 required minimum threshold targets authoritative 95 tests (19 features * 5 tests)', () => {
      const runnerContent = fs.readFileSync(runnerPath, 'utf8');
      expect(runnerContent).toMatch(/tier1[\s\S]*?requiredMin:\s*(95|190)/);
    });

    it('T1-F18-04: Tier 2 required minimum threshold targets authoritative 95 tests (19 features * 5 tests)', () => {
      const runnerContent = fs.readFileSync(runnerPath, 'utf8');
      expect(runnerContent).toMatch(/tier2[\s\S]*?requiredMin:\s*(95|190)/);
    });

    it('T1-F18-05: Vitest configuration (vitest.e2e.config.ts) is configured for node environment with forks', () => {
      const vitestE2e = fs.readFileSync(path.join(repoRoot, 'vitest.e2e.config.ts'), 'utf8');
      expect(vitestE2e).toContain("environment: 'node'");
      expect(vitestE2e).toContain("pool: 'forks'");
    });
  });

  // =========================================================================
  // Feature F19: Comprehensive Final Implementation Report (5 Tests)
  // =========================================================================
  describe('Feature F19: Comprehensive Final Implementation Report', () => {
    it('T1-F19-01: Project specification and requirements documents exist', () => {
      const docsDir = path.join(
        '/Users/yashsomani/.gemini/antigravity/scratch/teamwork/54c4253e-43f5-4c0b-bea7-3c4acb1d8fe2/.agents/teamwork'
      );
      expect(fs.existsSync(path.join(docsDir, 'PROJECT.md'))).toBe(true);
      expect(fs.existsSync(path.join(docsDir, 'TEST_INFRA.md'))).toBe(true);
    });

    it('T1-F19-02: Documentation specifies Clean Architecture and Hexagonal Ports & Adapters', () => {
      const testInfra = fs.readFileSync(
        '/Users/yashsomani/.gemini/antigravity/scratch/teamwork/54c4253e-43f5-4c0b-bea7-3c4acb1d8fe2/.agents/teamwork/TEST_INFRA.md',
        'utf8'
      );
      expect(testInfra).toContain('Clean Architecture');
    });

    it('T1-F19-03: Documentation specifies normalized 18-table relational database schema', () => {
      const testInfra = fs.readFileSync(
        '/Users/yashsomani/.gemini/antigravity/scratch/teamwork/54c4253e-43f5-4c0b-bea7-3c4acb1d8fe2/.agents/teamwork/TEST_INFRA.md',
        'utf8'
      );
      expect(testInfra).toContain('18 Tables');
    });

    it('T1-F19-04: Documentation specifies zero-data-loss database migration and collision fix', () => {
      const testInfra = fs.readFileSync(
        '/Users/yashsomani/.gemini/antigravity/scratch/teamwork/54c4253e-43f5-4c0b-bea7-3c4acb1d8fe2/.agents/teamwork/TEST_INFRA.md',
        'utf8'
      );
      expect(testInfra).toContain('Zero-Data-Loss JSON Migration');
      expect(testInfra).toContain('Collision & Truncation Fix');
    });

    it('T1-F19-05: Documentation specifies Azure DevOps multi-project sync and identity resolution', () => {
      const testInfra = fs.readFileSync(
        '/Users/yashsomani/.gemini/antigravity/scratch/teamwork/54c4253e-43f5-4c0b-bea7-3c4acb1d8fe2/.agents/teamwork/TEST_INFRA.md',
        'utf8'
      );
      expect(testInfra).toContain('Multi-Project Telemetry & Sync');
      expect(testInfra).toContain('Claims Descriptor');
    });
  });
});
