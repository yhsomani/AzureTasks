import { spawn } from 'node:child_process';
import path from 'node:path';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliRunnerOptions {
  env?: Record<string, string>;
  timeout?: number;
  cwd?: string;
}

export async function runCli(
  args: string[],
  options: CliRunnerOptions = {}
): Promise<CliResult> {
  const cwd = options.cwd || process.cwd();
  const entryPoint = path.resolve(cwd, 'src/index.ts');

  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', entryPoint, ...args], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ...(options.env || {}),
      },
      timeout: options.timeout || 15000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
  });
}
