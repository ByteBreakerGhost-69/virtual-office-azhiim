import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSim, startHarness, until, type Harness } from './harness.js';

let h: Harness;
let agentId: string;
beforeAll(async () => {
  h = await startHarness({ config: { simulationSpeed: 200 } });
  agentId = (await seedSim(h)).find((a: any) => a.handle === 'sim-rack').id;
});
afterAll(async () => { await h.stop(); });

const pending = async () => ((await h.owner.get('/approvals?status=pending')).json as any[])[0] ?? false;

describe('approvals', () => {
  it('runtime approval: approve continues the run and is audited', async () => {
    const t = await h.owner.post('/tasks', { title: 'Ship', objective: 'deploy the release', assigneeAgentId: agentId });
    const a = await until(pending, 15000, 'approval');
    expect(a.actionCategory).toBe('deployment');
    expect(a.mode).toBe('SIMULATED');
    await until(async () => (await h.owner.get(`/agents/${agentId}`)).json.agent.state === 'waiting', 5000, 'agent waiting');
    expect((await h.owner.get(`/tasks/${t.json.id}`)).json.task.status).toBe('awaiting_approval');
    const mismatch = await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'approve', payloadHash: 'deadbeef' });
    expect(mismatch.status).toBe(409);
    const ok = await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'approve', payloadHash: a.payloadHash });
    expect(ok.status).toBe(200);
    await until(async () => (await h.owner.get(`/tasks/${t.json.id}`)).json.task.status === 'completed', 15000, 'completed');
    expect(await h.db.auditLog.count({ where: { action: 'approval.approved' } })).toBe(1);
    expect((await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'approve' })).status).toBe(409);
  });

  it('reject needs a reason and fails the run', async () => {
    const t = await h.owner.post('/tasks', { title: 'Wipe', objective: 'delete old records', assigneeAgentId: agentId });
    const a = await until(pending, 15000, 'approval');
    expect((await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'reject' })).status).toBe(400);
    expect((await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'reject', reason: 'too risky' })).status).toBe(200);
    await until(async () => (await h.owner.get(`/tasks/${t.json.id}`)).json.task.status === 'failed', 15000, 'failed');
    // regression: a rejected approval must not leave the agent "thinking" with no active run
    await until(async () => (await h.owner.get(`/agents/${agentId}`)).json.agent.state === 'idle', 8000, 'agent idle again');
  });

  it('pre-run approval gate holds the task until approved', async () => {
    const t = await h.owner.post('/tasks', { title: 'Gate', objective: 'harmless job', assigneeAgentId: agentId, requiresApproval: true });
    const a = await until(pending, 8000, 'pre-run approval');
    expect((await h.owner.get(`/tasks/${t.json.id}`)).json.runs[0].state).toBe('awaiting_approval');
    expect(await h.db.run.count({ where: { providerRunId: { not: null }, taskId: t.json.id } })).toBe(0);
    await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'approve' });
    await until(async () => (await h.owner.get(`/tasks/${t.json.id}`)).json.task.status === 'completed', 15000, 'completed');
  });

  it('expired approvals never authorise the action', async () => {
    const t = await h.owner.post('/tasks', { title: 'Late', objective: 'publish the post', assigneeAgentId: agentId });
    const a = await until(pending, 15000, 'approval');
    await h.db.approval.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await h.owner.post(`/approvals/${a.id}/decide`, { decision: 'approve' })).status).toBe(409);
    const d = (await h.owner.get(`/tasks/${t.json.id}`)).json;
    expect(d.approvals[0].status).toBe('expired');
    expect(['blocked', 'failed']).toContain(d.task.status);
    expect(d.task.status).not.toBe('completed');
  });
});
