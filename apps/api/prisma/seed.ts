// Load the repo-root .env if present (Node >= 20.12). Real environment variables always win.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* no .env file: rely on the process environment */
}

/**
 * Idempotent seed: makes sure every existing workspace has the default departments.
 * It never creates users, agents or tasks — agents exist only when registered (REAL) or
 * explicitly seeded from the Integrations page as SIMULATED.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_DEPARTMENTS } from '@avo/shared';
import { createDb } from '../src/db.js';

const url = process.env.DATABASE_URL ?? 'postgresql://avo:avo_dev_password@127.0.0.1:5433/avo_dev';
const db = createDb(url);
try {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let added = 0;
  for (const w of workspaces) {
    for (const d of DEFAULT_DEPARTMENTS) {
      const exists = await db.department.findUnique({ where: { workspaceId_key: { workspaceId: w.id, key: d.key } } });
      if (exists) continue;
      await db.department.create({ data: { id: randomUUID(), workspaceId: w.id, key: d.key, name: d.name, color: d.color, homeRoom: d.homeRoom } });
      added++;
    }
  }
  console.log(`seed ok: ${workspaces.length} workspace(s), ${added} department(s) added`);
} finally {
  await db.$disconnect();
}
