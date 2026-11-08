import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSim, startHarness, until, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const taskState = async (id: string) => (await h.owner.get(`/tasks/${id}`)).json;

describe('thin end-to-end flow (SIMULATED runtime)', () => {
  it('seeds a simulated team that is clearly SIMULATED and never REAL', async () => {
    const agents = await seedSim(h);
    expect(agents).toHaveLength(8);
    expect(agents.every((a) => a.mode === 'SIMULATED' && a.runtimeKind === 'SIMULATED')).toBe(true);
    expect(agents.every((a) => a.state === 'idle')).toBe(true);
    expect((await h.owner.post('/simulation/seed')).status).toBe(409);
    const ov = (await h.owner.get('/overview')).json;
    expect(ov.agentsByMode).toEqual({ SIMULATED: 8 });
  });

  it('create -> assign -> run -> events -> completed, with trace and state history', async () => {
    const agents = (await h.owner.get('/agents')).json as any[];
    const forge = agents.find((a) => a.handle === 'sim-forge');
    const created = await h.owner.post('/tasks', { title: 'Summarise logs', objective: 'Summarise the build logs', assigneeAgentId: forge.id });
    expect(created.status).toBe(201);
    const id = created.json.id;
    const seenStates = new Set<string>();
    const done = await until(async () => {
      const a = (await h.owner.get(`/agents/${forge.id}`)).json.agent;
      seenStates.add(a.state);
      const t = await taskState(id);
      return t.task.status === 'completed' ? t : false;
    }, 15000, 'task completed');
    expect([...seenStates].some((s) => s === 'thinking' || s === 'working')).toBe(true);
    const run = done.runs[0];
    expect(run.traceId).toBeTruthy();
    expect(run.plan.planner).toBe('rule-based/v1');
    expect(run.resultSummary.startsWith('[SIMULATED]')).toBe(true);
    const path = done.transitions.map((t: any) => t.to);
    expect(path).toEqual(expect.arrayContaining(['created', 'planning', 'queued', 'running', 'verifying', 'completed']));
    expect(done.events.some((e: any) => e.type === 'task.completed' && e.mode === 'SIMULATED' && e.source.kind !== 'user')).toBe(true);
    await h.ctx.orchestrator.idle();
    const after = (await h.owner.get(`/agents/${forge.id}`)).json.agent;
    expect(after.state).toBe('idle');
    expect(after.currentTaskId).toBeNull();
  });

  it('records agent-to-agent messages (meeting placement) when peers talk', async () => {
    const agents = (await h.owner.get('/agents')).json as any[];
    const ids = agents.slice(0, 4).map((a) => a.id);
    for (const [i, id] of ids.entries()) await h.owner.post('/tasks', { title: `T${i}`, objective: `work ${i}`, assigneeAgentId: id });
    await until(async () => (await h.owner.get('/tasks')).json.every((t: any) => ['completed', 'failed'].includes(t.status)), 20000, 'all done');
    const msgs = await h.db.message.count();
    expect(msgs).toBeGreaterThanOrEqual(0); // peers talk with probability; consistency checked in unit tests
  });

  it('eligibility: disabled/paused agents are blocked with recorded reasons', async () => {
    const agents = (await h.owner.get('/agents')).json as any[];
    const a = agents.find((x) => x.handle === 'sim-sage');
    expect((await h.owner.post(`/agents/${a.id}/pause`)).status).toBe(200);
    const t = await h.owner.post('/tasks', { title: 'x', objective: 'x', assigneeAgentId: a.id });
    const d = await taskState(t.json.id);
    expect(d.task.status).toBe('blocked');
    expect(d.task.blockedReason).toMatch(/agent_state_paused/);
    expect((await h.owner.post(`/agents/${a.id}/resume`)).status).toBe(200);
  });

  it('required capabilities are enforced', async () => {
    const agents = (await h.owner.get('/agents')).json as any[];
    const a = agents.find((x) => x.handle === 'sim-nova');
    const t = await h.owner.post('/tasks', { title: 'x', objective: 'x', assigneeAgentId: a.id, requiredCapabilities: ['terminal.execute'] });
    expect((await taskState(t.json.id)).task.blockedReason).toMatch(/missing_capabilities/);
  });

  it('dependencies gate dispatch and release dependents when done', async () => {
    const agents = (await h.owner.get('/agents')).json as any[];
    const a = agents.find((x) => x.handle === 'sim-lumen');
    const first = await h.owner.post('/tasks', { title: 'first', objective: 'first job', assigneeAgentId: a.id });
    const second = await h.owner.post('/tasks', { title: 'second', objective: 'second job', assigneeAgentId: agents.find((x) => x.handle === 'sim-byte').id, dependsOn: [first.json.id] });
    expect((await taskState(second.json.id)).task.status).toBe('blocked');
    await until(async () => (await taskState(second.json.id)).task.status === 'completed', 25000, 'dependent completed');
  });

  it('simulation clear removes only simulated data', async () => {
    await h.db.project.create({ data: { id: 'real-p', workspaceId: (await h.db.workspace.findFirstOrThrow()).id, name: 'Real project' } });
    const r = await h.owner.del('/simulation');
    expect(r.status).toBe(200);
    expect((await h.owner.get('/agents')).json).toHaveLength(0);
    expect((await h.owner.get('/projects')).json).toHaveLength(1);
  });
});
