import { applyMigrations } from '../scripts/apply-migrations.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://avo:avo_dev_password@127.0.0.1:5433/avo_test';

export default async function setup(): Promise<void> {
  await applyMigrations(TEST_DB_URL);
}
