#!/usr/bin/env node
/**
 * Offline, portable recovery bundle for non-secret application state.
 * Does not copy .env/PATs, modify Azure DevOps or overwrite existing state.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const command = args[0];
function option(flag) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
function fail(message) { throw new Error(message); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function ensureOffline() {
  if (!args.includes('--offline-confirm')) {
    fail('Stop the application and pass --offline-confirm; never snapshot or restore live JSON files.');
  }
}
function validateJson(name, bytes) {
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (name !== 'people.json' && !Array.isArray(parsed)) {
    fail(name + ' must contain an array of audit journal entries.');
  }
  if (name === 'people.json' && (!parsed || typeof parsed !== 'object')) {
    fail('people.json must contain an object or legacy people array.');
  }
}
function fileNames(state) {
  const paths = ['people.json', '.task-journal.json'];
  const archives = path.join(state, '.journal-archives');
  if (fs.existsSync(archives)) {
    for (const name of fs.readdirSync(archives).sort()) {
      if (/^task-journal-[a-zA-Z0-9_.-]+\.json$/.test(name)) {
        paths.push('.journal-archives/' + name);
      }
    }
  }
  return paths.filter(name => fs.existsSync(path.join(state, name)));
}
function validName(name) {
  return name === 'people.json' || name === '.task-journal.json' ||
    /^\.journal-archives\/task-journal-[a-zA-Z0-9_.-]+\.json$/.test(name);
}
function readManifest(bundle) {
  const file = path.join(bundle, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) ||
      !manifest.files.some(row => row.name === 'people.json')) {
    fail('Invalid or incomplete state backup manifest.');
  }
  const seen = new Set();
  for (const row of manifest.files) {
    if (!row || typeof row.name !== 'string' || !validName(row.name) ||
        seen.has(row.name) || !/^[0-9a-f]{64}$/.test(row.sha256)) {
      fail('Invalid or duplicated backup manifest filename/hash.');
    }
    seen.add(row.name);
    const input = path.join(bundle, row.name);
    if (fs.lstatSync(input).isSymbolicLink() || !fs.statSync(input).isFile()) {
      fail('Backups may only contain regular files: ' + row.name);
    }
    const bytes = fs.readFileSync(input);
    if (sha256(bytes) !== row.sha256 || bytes.length !== row.size) {
      fail('Backup checksum/length mismatch for ' + row.name);
    }
    validateJson(row.name === '.task-journal.json' ||
      row.name.startsWith('.journal-archives/') ? row.name : 'people.json', bytes);
  }
  return manifest;
}
try {
  const stateRaw = option('--state-dir');
  const bundleRaw = option('--backup-dir');
  if (!['backup', 'verify', 'restore'].includes(command) || !bundleRaw ||
      ((command === 'backup' || command === 'restore') && !stateRaw)) {
    fail('Usage: backup|restore --state-dir DIR --backup-dir DIR --offline-confirm; verify --backup-dir DIR');
  }
  const bundle = path.resolve(bundleRaw);
  if (command === 'backup') {
    ensureOffline();
    const state = fs.realpathSync(path.resolve(stateRaw));
    if (bundle === state || bundle.startsWith(state + path.sep)) {
      fail('Backup destination must be outside the application state directory.');
    }
    if (fs.existsSync(bundle)) fail('Backup directory already exists: refusing to overwrite.');
    if (fs.existsSync(path.join(state, '.execution-lock.json'))) {
      fail('Execution lock exists: verify the app has stopped and recover the lock before backing up.');
    }
    const names = fileNames(state);
    if (!names.includes('people.json')) fail('people.json is required for a complete state backup.');
    fs.mkdirSync(bundle, { mode: 0o700 });
    try {
      const files = [];
      for (const name of names) {
        const src = path.join(state, name);
        if (fs.lstatSync(src).isSymbolicLink() || !fs.statSync(src).isFile()) {
          fail('Refusing to back up a non-regular or linked file: ' + name);
        }
        const bytes = fs.readFileSync(src);
        validateJson(name, bytes);
        const target = path.join(bundle, name);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
        files.push({ name, size: bytes.length, sha256: sha256(bytes) });
      }
      fs.writeFileSync(path.join(bundle, 'manifest.json'),
        JSON.stringify({ version: 1, createdAt: new Date().toISOString(),
          secretsExcluded: true, files }, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' });
      readManifest(bundle);
    } catch (error) {
      fs.rmSync(bundle, { recursive: true, force: true });
      throw error;
    }
    console.log('Verified non-secret state backup created. Store it securely; credentials must be recovered separately.');
  } else if (command === 'verify') {
    const manifest = readManifest(fs.realpathSync(bundle));
    console.log('Verified ' + manifest.files.length + ' backed-up file(s) against SHA-256.');
  } else {
    ensureOffline();
    const archive = fs.realpathSync(bundle);
    const state = path.resolve(stateRaw);
    const manifest = readManifest(archive);
    if (state === archive || state.startsWith(archive + path.sep)) {
      fail('Restore destination must not be inside the backup.');
    }
    if (fs.existsSync(state)) {
      if (!fs.statSync(state).isDirectory() || fs.readdirSync(state).length !== 0) {
        fail('Restore destination must be a new or empty directory. Never overwrite live state.');
      }
    } else {
      fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    }
    for (const row of manifest.files) {
      const dest = path.join(state, row.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.writeFileSync(dest, fs.readFileSync(path.join(archive, row.name)),
        { flag: 'wx', mode: 0o600 });
    }
    console.log('Verified state restored to an empty directory. Supply fresh secrets separately before startup.');
  }
} catch (error) {
  console.error('State recovery failed: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
