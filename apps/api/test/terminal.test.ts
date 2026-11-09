import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, seedSim, startHarness, until, Client, type Harness } from './harness.js';
import { complete, parseInput, tokenize, redactInput } from '@avo/shared';
import { REGISTRY, metaOf } from '../src/modules/terminal/registry.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); await seedSim(h); });
afterAll(async () => { await h.stop(); });
const run = async (input: string, c: Client = h.owner) => (await c.post('/terminal/execute', { input })).json;

describe('terminal parser + autocomplete (pure)', () => {
  it('tokenizes quotes and flags', () => {
    expect(tokenize('task create "Fix the bug" --assign EMP-001').tokens).toEqual(['task', 'create', 'Fix the bug', '--assign', 'EMP-001']);
    expect(tokenize('say "oops').error).toMatch(/Unterminated/);
    expect(parseInput('a b --x 1 --flag --y=2').flags).toEqual({ x: '1', flag: true, y: '2' });
  });
  it('completes command words, flags and refs', () => {
    const m = REGISTRY.map(metaOf);
    expect(complete(m, 'emp').options).toEqual(['employee']);
    expect(complete(m, 'employee ').options).toEqual(expect.arrayContaining(['hire', 'list', 'onboard']));
    expect(complete(m, 'employee hire atlas --a').options).toEqual(['--avatar']);
    expect(complete(m, 'task assign TASK-001 ', { employee: ['EMP-001', 'EMP-002'] }).options).toEqual(['EMP-001', 'EMP-002']);
  });
  it('redacts secrets before history', () => {
    expect(redactInput('x --api-key sk-123 --token=abc')).toBe('x --api-key [redacted] --token=[redacted]');
  });
});

describe('Company Terminal (API-backed)', () => {
  it('is not a shell: arbitrary commands are refused and recorded', async () => {
    for (const cmd of ['rm -rf /', 'sudo ls', 'bash x.sh', 'ls; cat /etc/passwd']) {
      const r = await run(cmd);
      expect(r.status).toBe('FAILED');
      expect(r.command).toBeNull();
    }
    const hist = (await h.owner.get('/terminal/history')).json;
    expect(hist.some((e: any) => e.input === 'rm -rf /' && e.status === 'FAILED')).toBe(true);
  });

  it('company status and employee list come from the backend', async () => {
    const s = await run('company status');
    expect(s.status).toBe('SUCCESS');
    expect(s.data.agents).toBe(8);
    const l = await run('employee list');
    expect(l.status).toBe('SUCCESS');
    expect(l.data).toHaveLength(0); // nobody is hired yet: agents are not employees until hired
    expect((await run('employee candidates')).data).toHaveLength(8);
  });

  it('validates input with useful errors', async () => {
    expect((await run('employee hire')).message).toMatch(/Missing argument <agent>/);
    expect((await run('employee hire sim-forge --avatar zz')).message).toMatch(/must be one of/);
    expect((await run('employee hire sim-forge --nope 1')).message).toMatch(/Unknown flag --nope/);
  });

  it('hire -> onboard -> create+assign task -> real events complete it; everything audited', async () => {
    const hire = await run('employee hire sim-forge --title "Backend Engineer" --dept engineering --avatar a3');
    expect(hire.status).toBe('SUCCESS');
    expect(hire.data.code).toBe('EMP-001');
    expect(hire.data.employment).toBe('PENDING_ONBOARDING');
    expect(hire.auditId).toBeTruthy();
    // pending employees cannot receive work
    const early = await run('task create "Too early" --assign EMP-001');
    expect(early.status).toBe('FAILED');
    expect(early.message).toMatch(/PENDING_ONBOARDING/);

    const on = await run('employee onboard EMP-001');
    expect(on.status).toBe('SUCCESS');
    expect(on.message).toMatch(/SIMULATED/);

    const t = await run('task create "Summarise logs" --objective "Summarise build logs" --assign EMP-001');
    expect(t.status).toBe('SUCCESS');
    expect(t.data.code).toBe('TASK-001');
    await until(async () => (await run('task show TASK-001')).data.status === 'completed', 20000, 'task done');
    await h.ctx.orchestrator.idle();
    const emp = (await run('employee show EMP-001')).data;
    expect(emp.state).toBe('idle');
    expect(emp.avatarId).toBe('a3');

    const audits = await h.db.auditLog.findMany({ where: { action: { startsWith: 'terminal.' } } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['terminal.employee.hire', 'terminal.employee.onboard', 'terminal.task.create']));
    expect(audits.every((a) => (a.details as any).source === 'CLI')).toBe(true);
    expect(await h.db.commandExecution.count()).toBeGreaterThan(10);
  });

  it('suspend blocks assignment; resume restores it', async () => {
    expect((await run('employee suspend EMP-001')).status).toBe('SUCCESS');
    const blocked = await run('task create "Nope" --assign EMP-001');
    expect(blocked.status).toBe('FAILED');
    expect((await run('employee resume EMP-001')).status).toBe('SUCCESS');
  });

  it('offline runtime keeps an employee PENDING_ONBOARDING and never shows working', async () => {
    const integ = await h.owner.post('/integrations', { kind: 'HERMES', name: 'dead hermes', baseUrl: 'http://127.0.0.1:1', secret: 'test-key-123' });
    expect(integ.status).toBe(201);
    const ag = await h.owner.post('/agents', { integrationId: integ.json.id, name: 'Ghost', handle: 'ghost', title: 'Ghost', runtimeRef: 'ghost' });
    expect(ag.status).toBe(201);
    await run('employee hire ghost --dept engineering');
    const on = await run('employee onboard ghost');
    expect(on.status).toBe('FAILED');
    expect(on.message).toMatch(/PENDING_ONBOARDING/);
    const d = (await h.owner.get(`/agents/${ag.json.id}`)).json.agent;
    expect(d.employmentStatus).toBe('PENDING_ONBOARDING');
    expect(['working', 'thinking']).not.toContain(d.state);
  });

  it('observer: read commands run, mutations are rejected and audited', async () => {
    const ws = (await h.db.workspace.findFirstOrThrow()).id;
    const u = await h.db.user.create({ data: { id: 'obs-u', username: 'obs', displayName: 'Obs', passwordHash: (await h.ctx.db.user.findFirstOrThrow()).passwordHash } });
    await h.db.workspaceMember.create({ data: { id: 'obs-m2', workspaceId: ws, userId: u.id, role: 'OBSERVER' } });
    const obs = new Client(h.app);
    expect((await obs.post('/auth/login', { username: 'obs', password: PASSWORD })).status).toBe(200);
    expect((await run('employee list', obs)).status).toBe('SUCCESS');
    const r = await run('task create "x"', obs);
    expect(r.status).toBe('REJECTED');
    expect(r.message).toMatch(/Permission denied/);
    expect(await h.db.auditLog.count({ where: { action: 'terminal.denied' } })).toBe(1);
    expect(await h.db.task.count({ where: { title: 'x' } })).toBe(0);
  });

  it('owner position persists and room change emits an event', async () => {
    expect((await h.owner.get('/office/position')).json).toBeNull();
    expect((await h.owner.req('PUT', '/office/position', { room: 'main_office', x: 100, y: 160, direction: 'left' })).status).toBe(200);
    expect((await h.owner.req('PUT', '/office/position', { room: 'lounge', x: 900, y: 400, direction: 'up' })).status).toBe(200);
    expect((await h.owner.get('/office/position')).json).toMatchObject({ room: 'lounge', x: 900, direction: 'up' });
    expect((await h.owner.req('PUT', '/office/position', { room: 'nowhere', x: 1, y: 1, direction: 'up' })).status).toBe(400);
    expect(await h.db.activityEvent.count({ where: { type: 'office.room_changed' } })).toBe(1);
  });
});
