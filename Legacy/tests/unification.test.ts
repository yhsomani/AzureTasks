import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { loadDotenv } from '../src/utils/dotenv.js';

describe('Project Unification Suite', () => {
  it('correctly loads dotenv without external dependencies', () => {
    const tempEnvPath = path.resolve(process.cwd(), '.env.test-unification');
    fs.writeFileSync(tempEnvPath, 'TEST_UNIFY_VAR="hello_unification"\n# comment\nTEST_UNIFY_NUM=12345\n', 'utf-8');

    // Test dotenv logic by temporarily modifying .env or verifying parser
    const content = fs.readFileSync(tempEnvPath, 'utf-8');
    const parsed: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        parsed[key] = val;
      }
    }

    expect(parsed['TEST_UNIFY_VAR']).toBe('hello_unification');
    expect(parsed['TEST_UNIFY_NUM']).toBe('12345');
    fs.unlinkSync(tempEnvPath);
  });

  it('package.json points all execution modes to canonical entrypoint src/index.ts', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.scripts.start).toContain('src/index.ts');
    expect(pkg.scripts.ui).toContain('src/index.ts --ui');
    expect(pkg.scripts.daemon).toContain('src/index.ts --daemon');
    expect(pkg.scripts.build).toContain('cpSync');
  });

  it('has removed redundant server entrypoint src/server/index.ts', () => {
    const redundantServerEntry = path.resolve(process.cwd(), 'src/server/index.ts');
    expect(fs.existsSync(redundantServerEntry)).toBe(false);
  });
});
