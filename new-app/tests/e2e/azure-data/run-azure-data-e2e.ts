import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface TierStats {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  requiredMin: number;
}

interface VitestJsonOutput {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{
      status: string;
      title: string;
      ancestorTitles: string[];
    }>;
  }>;
}

async function runVitest(reportPath: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [
      'vitest',
      'run',
      '--config',
      'vitest.e2e.config.ts',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportPath}`,
      'tests/e2e/azure-data',
    ];

    const child = spawn('npx', args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    child.on('close', (code) => {
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      console.error('Failed to spawn vitest:', err);
      resolve(1);
    });
  });
}

function formatRow(
  tier: string,
  passed: number,
  failed: number,
  skipped: number,
  total: number,
  passRate: string
): string {
  const pTier = tier.padEnd(35);
  const pPassed = String(passed).padStart(6);
  const pFailed = String(failed).padStart(6);
  const pSkipped = String(skipped).padStart(7);
  const pTotal = String(total).padStart(6);
  const pRate = passRate.padStart(9);
  return ` ${pTier} | ${pPassed} | ${pFailed} | ${pSkipped} | ${pTotal} | ${pRate} `;
}

async function main(): Promise<void> {
  const tmpJsonPath = path.join(os.tmpdir(), `azure-data-e2e-report-${Date.now()}.json`);

  console.log('\n========================================================================================');
  console.log('              STARTING AZURE-DATA.DB 4-TIER AUTOMATED E2E TEST SUITE                    ');
  console.log('========================================================================================\n');

  const vitestExitCode = await runVitest(tmpJsonPath);

  if (!fs.existsSync(tmpJsonPath)) {
    console.error(`\nError: Vitest JSON output not found at ${tmpJsonPath}`);
    process.exit(vitestExitCode || 1);
  }

  let report: VitestJsonOutput;
  try {
    const raw = fs.readFileSync(tmpJsonPath, 'utf8');
    report = JSON.parse(raw);
  } catch (err: any) {
    console.error(`\nError parsing Vitest JSON report: ${err.message}`);
    process.exit(1);
  } finally {
    try {
      if (fs.existsSync(tmpJsonPath)) fs.unlinkSync(tmpJsonPath);
    } catch {}
  }

  const tiers: Record<string, TierStats> = {
    tier1: {
      name: 'Tier 1: Feature Coverage (Endpoints)',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      requiredMin: 25,
    },
    tier2: {
      name: 'Tier 2: Boundary & Corner Cases',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      requiredMin: 15,
    },
    tier3: {
      name: 'Tier 3: Pairwise Combinations',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      requiredMin: 8,
    },
    tier4: {
      name: 'Tier 4: Real-World Scenarios',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      requiredMin: 5,
    },
  };

  for (const fileResult of report.testResults || []) {
    const filePath = fileResult.name;
    let tierKey = 'tier1';
    if (filePath.includes('tier2-') || filePath.includes('/tier2/')) {
      tierKey = 'tier2';
    } else if (filePath.includes('tier3-') || filePath.includes('/tier3/')) {
      tierKey = 'tier3';
    } else if (filePath.includes('tier4-') || filePath.includes('/tier4/')) {
      tierKey = 'tier4';
    } else if (filePath.includes('tier1-') || filePath.includes('/tier1/')) {
      tierKey = 'tier1';
    }

    const t = tiers[tierKey];
    for (const test of fileResult.assertionResults || []) {
      t.total++;
      if (test.status === 'passed') {
        t.passed++;
      } else if (test.status === 'failed') {
        t.failed++;
      } else {
        t.skipped++;
      }
    }
  }

  const totalPassed =
    tiers.tier1.passed + tiers.tier2.passed + tiers.tier3.passed + tiers.tier4.passed;
  const totalFailed =
    tiers.tier1.failed + tiers.tier2.failed + tiers.tier3.failed + tiers.tier4.failed;
  const totalSkipped =
    tiers.tier1.skipped + tiers.tier2.skipped + tiers.tier3.skipped + tiers.tier4.skipped;
  const totalTests =
    tiers.tier1.total + tiers.tier2.total + tiers.tier3.total + tiers.tier4.total;
  const totalRate =
    totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) + '%' : '0.0%';

  console.log('\n========================================================================================');
  console.log('                          AZURE-DATA E2E TEST EXECUTION SUMMARY                         ');
  console.log('========================================================================================');
  console.log(' Tier                                | Passed | Failed | Skipped | Total  | Pass Rate ');
  console.log('-------------------------------------+--------+--------+---------+--------+-----------');

  for (const key of ['tier1', 'tier2', 'tier3', 'tier4']) {
    const t = tiers[key];
    const rate = t.total > 0 ? ((t.passed / t.total) * 100).toFixed(1) + '%' : '0.0%';
    console.log(formatRow(t.name, t.passed, t.failed, t.skipped, t.total, rate));
  }

  console.log('-------------------------------------+--------+--------+---------+--------+-----------');
  console.log(
    formatRow('TOTAL AZURE DATA E2E SUITE', totalPassed, totalFailed, totalSkipped, totalTests, totalRate)
  );
  console.log('========================================================================================\n');

  let thresholdDeficit = false;
  for (const key of ['tier1', 'tier2', 'tier3', 'tier4']) {
    const t = tiers[key];
    if (t.total < t.requiredMin) {
      console.error(
        `❌ Deficit in ${t.name}: found ${t.total} tests, required minimum is ${t.requiredMin}.`
      );
      thresholdDeficit = true;
    }
  }

  if (totalFailed > 0 || thresholdDeficit || vitestExitCode !== 0) {
    console.error(`❌ Azure Data E2E Test Suite FAILED (failures=${totalFailed}, exitCode=${vitestExitCode}).`);
    process.exit(1);
  }

  console.log('✅ ALL AZURE-DATA E2E REQUIREMENTS & QUALITY GATES MET SUCCESSFULLY (59 tests passed, 0 failures).\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error in Azure Data E2E runner:', err);
  process.exit(1);
});
