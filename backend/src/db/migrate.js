import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase } from './database.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(currentDirectory, '../../migrations');
const config = loadConfig();
const db = createDatabase(config);

if (!db.available) {
  throw new Error('DATABASE_URL é obrigatória para executar as migrações.');
}

const run = async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDirectory)).filter(file => file.endsWith('.sql')).sort();
  const applied = await db.query('SELECT name FROM schema_migrations');
  const appliedNames = new Set(applied.rows.map(row => row.name));

  for (const file of files) {
    if (appliedNames.has(file)) continue;
    const sql = await readFile(join(migrationsDirectory, file), 'utf8');
    await db.transaction(async transaction => {
      await transaction.query(sql);
      await transaction.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`Migração aplicada: ${file}`);
  }
};

try {
  await run();
} finally {
  await db.close();
}
