/**
 * Applies prisma/migrations/*\/migration.sql in order. USED BY TESTS ONLY (they need a schema without the Prisma engine).
 * For real databases use `npm run db:migrate` (prisma migrate deploy), which also records history in _prisma_migrations.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

export async function applyMigrations(connectionString: string): Promise<void> {
  const dir = join(here, '../prisma/migrations');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name, 'migration.sql');
      if (existsSync(file)) await client.query(readFileSync(file, 'utf8'));
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await applyMigrations(url);
  console.log('migrations applied (test runner; destructive: public schema was recreated)');
}
