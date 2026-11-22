import path from 'node:path';
import process from 'node:process';
import { normalizeDatabase } from './normalize.mjs';

const databasePath = path.resolve(process.argv[2] || 'azure-data.db');
const result = normalizeDatabase(databasePath);
console.log(JSON.stringify({ databasePath, normalized: result }, null, 2));
