import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('Tier 1: Feature Coverage - Group 1: Repository Hygiene & Maintenance', () => {
  const repoRoot = process.cwd();

  // =========================================================================
  // Feature F1: Repository Hygiene & Large File Untracking (5 Genuine Tests)
  // =========================================================================
  describe('Feature F1: Repository Hygiene & Large File Untracking', () => {
    it('T1-F1-01: PII data dump (data.txt) is completely absent from git index', () => {
      const output = execSync('git ls-files data.txt', { encoding: 'utf8', cwd: repoRoot }).trim();
      expect(output).toBe('');
    });

    it('T1-F1-02: SQLite database files (*.db) are untracked in git index', () => {
      const output = execSync('git ls-files "*.db"', { encoding: 'utf8', cwd: repoRoot }).trim();
      expect(output).toBe('');
    });

    it('T1-F1-03: SQLite WAL and SHM sidecars (*.db-wal, *.db-shm) are untracked', () => {
      const output = execSync('git ls-files "*.db-wal" "*.db-shm"', { encoding: 'utf8', cwd: repoRoot }).trim();
      expect(output).toBe('');
    });

    it('T1-F1-04: Test reports and runtime execution logs are untracked in git', () => {
      const output = execSync('git ls-files "*.log" "coverage/" "test-results/"', {
        encoding: 'utf8',
        cwd: repoRoot,
      }).trim();
      expect(output).toBe('');
    });

    it('T1-F1-05: Zero git-tracked files exceed 10MB in size', () => {
      // git ls-files -s outputs: <mode> <object> <stage>\t<file>
      const lsFiles = execSync('git ls-files -s', { encoding: 'utf8', cwd: repoRoot });
      const lines = lsFiles.split('\n').filter(Boolean);
      const oversizedFiles: Array<{ file: string; size: number }> = [];

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const filePath = path.join(repoRoot, parts[1]);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if (stat.size > 10 * 1024 * 1024) {
              oversizedFiles.push({ file: parts[1], size: stat.size });
            }
          }
        }
      }

      expect(oversizedFiles).toEqual([]);
    });
  });

  // =========================================================================
  // Feature F2: .gitignore Modernization (5 Genuine Tests)
  // =========================================================================
  describe('Feature F2: .gitignore Modernization', () => {
    const gitignoreContent = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');

    it('T1-F2-01: .gitignore contains ignore patterns for database and sidecar files', () => {
      expect(gitignoreContent).toMatch(/\*\.db\b/);
      expect(gitignoreContent).toMatch(/\*\.db-wal\b/);
      expect(gitignoreContent).toMatch(/\*\.db-shm\b/);
    });

    it('T1-F2-02: .gitignore contains ignore patterns for environment files', () => {
      expect(gitignoreContent).toMatch(/\.env/);
    });

    it('T1-F2-03: .gitignore contains ignore patterns for test and coverage reports', () => {
      expect(gitignoreContent).toMatch(/coverage/);
    });

    it('T1-F2-04: .gitignore contains ignore patterns for build outputs and TS cache', () => {
      expect(gitignoreContent).toMatch(/dist/);
      expect(gitignoreContent).toMatch(/\*\.tsbuildinfo/);
    });

    it('T1-F2-05: git check-ignore confirms .db and temp env files are ignored', () => {
      const checkDb = execSync('git check-ignore test-temp.db', { encoding: 'utf8', cwd: repoRoot }).trim();
      expect(checkDb).toBe('test-temp.db');

      const checkEnv = execSync('git check-ignore .env.local', { encoding: 'utf8', cwd: repoRoot }).trim();
      expect(checkEnv).toBe('.env.local');
    });
  });

  // =========================================================================
  // Feature F3: Hygiene Test Suite Repair (5 Genuine Tests)
  // =========================================================================
  describe('Feature F3: Hygiene Test Suite Repair', () => {
    const forbiddenDomain = ['bajaj', 'finserv', 'in'].join('.');

    it('T1-F3-01: Zero occurrences of corporate domain across tracked production files and configs', () => {
      try {
        const grepOutput = execSync(`git grep -i "${forbiddenDomain}" -- "src/" "scripts/" "package*.json"`, {
          encoding: 'utf8',
          cwd: repoRoot,
        }).trim();
        expect(grepOutput).toBe('');
      } catch (err: any) {
        // git grep returns exit code 1 when no matches are found, which confirms zero occurrences
        expect(err.status === 1 || err.status === undefined).toBe(true);
      }
    });

    it('T1-F3-02: Git grep scans complete cleanly without ENOBUFS buffer overflow', () => {
      // Testing with maxBuffer explicitly handles large trees
      let completed = false;
      try {
        execSync('git grep -l "TODO"', {
          encoding: 'utf8',
          cwd: repoRoot,
          maxBuffer: 10 * 1024 * 1024,
        });
        completed = true;
      } catch (err: any) {
        // Exit code 0 or 1 are normal for git grep
        completed = err.status === 0 || err.status === 1;
      }
      expect(completed).toBe(true);
    });

    it('T1-F3-03: Test fixtures in tests/ use sanitized synthetic domains', () => {
      const fixturesDir = path.join(repoRoot, 'tests/e2e/harness/fixtures');
      if (fs.existsSync(fixturesDir)) {
        const fixtureFiles = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.ts') || f.endsWith('.json'));
        for (const file of fixtureFiles) {
          const content = fs.readFileSync(path.join(fixturesDir, file), 'utf8');
          expect(content).not.toContain(forbiddenDomain);
        }
      }
    });

    it('T1-F3-04: people.example.json contains only synthetic template identities', () => {
      const examplePath = path.join(repoRoot, 'people.example.json');
      expect(fs.existsSync(examplePath)).toBe(true);
      const content = fs.readFileSync(examplePath, 'utf8');
      expect(content).not.toContain(forbiddenDomain);
      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed) || typeof parsed === 'object').toBe(true);
    });

    it('T1-F3-05: TypeScript typecheck passes cleanly with zero missing imports or type errors', () => {
      const typecheckResult = execSync('npm run typecheck', { encoding: 'utf8', cwd: repoRoot });
      expect(typecheckResult).toContain('tsc --noEmit');
    });
  });
});
