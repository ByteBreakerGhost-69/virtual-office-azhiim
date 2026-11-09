import type { Db } from '../db.js';

/** Atomic per-workspace sequence. Backed by one row per (workspace,key); the increment happens inside Postgres. */
export async function nextSequence(db: Pick<Db, 'counter'>, workspaceId: string, key: 'employee' | 'task'): Promise<number> {
  const row = await db.counter.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: { workspaceId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export const formatCode = (prefix: 'EMP' | 'TASK', n: number): string => `${prefix}-${String(n).padStart(3, '0')}`;
