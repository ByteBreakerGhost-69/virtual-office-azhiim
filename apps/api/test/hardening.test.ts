import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSim, startHarness, until, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness({ config: { simulationSpeed: 100 } }); });
afterAll(async () => { await h.stop(); });

describe('hardening', () => {
  it('integration secrets are encrypted at rest and never returned', async () => {
    const r = await h.owner.post('/integrations', { kind: 'HERMES', name: 'Secret holder', baseUrl: 'http://127.0.0.1:9', secret: 'super-secret-token-123' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.json)).not.toContain('super-secret-token-123');
    expect((r.json as any).hasSecret).toBe(true);
    const list = await h.owner.get('/integrations');
    expect(JSON.stringify(list.json)).not.toContain('super-secret-token-123');
    const row = await h.db.integration.findFirstOrThrow({ where: { name: 'Secret holder' } });
    expect(JSON.stringify(row)).not.toContain('super-secret-token-123');
  });

  it('emergency stop pauses dispatch, cancels active runs and can be resumed; everything is audited', async () => {
    const agents = await seedSim(h);
    const id = agents.find((a: any) => a.handle === 'sim-rack').id;
    const t = await h.owner.post('/tasks', { title: 'Long', objective: 'deploy it', assigneeAgentId: id }); // waits on an approval
    await until(async () => ((await h.owner.get('/approvals?status=pending')).json as any[])[0] ?? false, 15000, 'approval');
    const stop = await h.owner.post('/control/emergency-stop', {});
    expect(stop.status).toBe(200);
    expect((await h.owner.get('/overview')).json.dispatchPaused).toBe(true);
    await until(async () => ['cancelled', 'failed', 'blocked'].includes((await h.owner.get(`/tasks/${t.json.id}`)).json.task.status), 15000, 'task stopped');
    const blocked = await h.owner.post('/tasks', { title: 'After stop', objective: 'harmless', assigneeAgentId: id });
    expect(blocked.status).toBeLessThan(500);
    expect((await h.owner.get(`/tasks/${blocked.json.id}`)).json.task.status).not.toBe('running');
    expect((await h.owner.post('/control/resume-dispatch', {})).status).toBe(200);
    expect((await h.owner.get('/overview')).json.dispatchPaused).toBe(false);
    expect(await h.db.auditLog.count({ where: { action: 'control.emergency_stop' } })).toBe(1);
  });

  it('every prisma table in the migration exists (schema parity)', async () => {
    const rows = await h.db.$queryRawUnsafe<{ table_name: string }[]>("select table_name from information_schema.tables where table_schema='public'");
    const names = new Set(rows.map((r) => r.table_name));
    for (const t of ['User', 'Workspace', 'Session', 'Department', 'Integration', 'Agent', 'Task', 'Run', 'Approval', 'Message', 'ActivityEvent', 'AuditLog', 'MemoryRecord', 'Setting', 'Project', 'TaskDependency', 'RunStateTransition', 'WorkspaceMember']) expect(names.has(t), t).toBe(true);
  });
});
