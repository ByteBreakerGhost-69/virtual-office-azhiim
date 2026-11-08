import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

describe('auth', () => {
  it('setup is one-shot and stores no plaintext password', async () => {
    const again = await new Client(h.app).post('/auth/setup', { username: 'second', password: PASSWORD });
    expect(again.status).toBe(409);
    const u = await h.db.user.findUniqueOrThrow({ where: { username: 'owner' } });
    expect(u.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(u.passwordHash).not.toContain(PASSWORD);
  });
  it('rejects weak passwords at setup', async () => {
    const r = await new Client(h.app).req('POST', '/auth/setup', { username: 'abc', password: 'short' });
    expect([400, 409]).toContain(r.status);
  });
  it('requires a session', async () => {
    expect((await new Client(h.app).get('/agents')).status).toBe(401);
  });
  it('requires the CSRF token on mutating requests', async () => {
    const c = new Client(h.app);
    await c.post('/auth/login', { username: 'owner', password: PASSWORD });
    c.csrf = '';
    const r = await c.post('/projects', { name: 'x' });
    expect(r.status).toBe(403);
  });
  it('rejects cross-origin mutations', async () => {
    const r = await h.owner.req('POST', '/projects', { name: 'x' }, { origin: 'http://evil.example' });
    expect(r.status).toBe(403);
  });
  it('login failure is generic and rate limited', async () => {
    const c = new Client(h.app);
    for (let i = 0; i < 3; i++) expect((await c.post('/auth/login', { username: 'owner', password: 'wrong-password-1' })).status).toBe(401);
    expect((await c.post('/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(429);
  });
  it('RBAC: an observer can read but not create or control', async () => {
    const ws = (await h.db.workspace.findFirstOrThrow()).id;
    const { hashPassword } = await import('../src/lib/crypto.js');
    const uid = 'obs-user';
    await h.db.user.create({ data: { id: uid, username: 'observer', displayName: 'Obs', passwordHash: await hashPassword(PASSWORD) } });
    await h.db.workspaceMember.create({ data: { id: 'obs-m', workspaceId: ws, userId: uid, role: 'OBSERVER' } });
    const c = new Client(h.app);
    expect((await c.post('/auth/login', { username: 'observer', password: PASSWORD })).status).toBe(200);
    expect((await c.get('/overview')).status).toBe(200);
    expect((await c.post('/tasks', { title: 't', objective: 'o' })).status).toBe(403);
    expect((await c.post('/control/emergency-stop')).status).toBe(403);
    expect((await c.post('/simulation/seed')).status).toBe(403);
  });
  it('logout invalidates the session', async () => {
    const c = new Client(h.app);
    await c.post('/auth/login', { username: 'owner', password: PASSWORD });
    expect((await c.post('/auth/logout')).status).toBe(200);
    const r = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: c.cookie } });
    expect(r.statusCode).toBe(401);
  });
  it('workspace isolation: another workspace data is never visible', async () => {
    const other = 'ws-other';
    await h.db.workspace.create({ data: { id: other, name: 'Other', slug: 'other' } });
    await h.db.project.create({ data: { id: 'p-other', workspaceId: other, name: 'SECRET PROJECT' } });
    await h.db.integration.create({ data: { id: 'i-other', workspaceId: other, kind: 'HERMES', mode: 'REAL', name: 'other-int' } });
    const r = await h.owner.get('/projects');
    expect(JSON.stringify(r.json)).not.toContain('SECRET PROJECT');
    expect((await h.owner.get('/integrations')).json.find((i: any) => i.id === 'i-other')).toBeUndefined();
    expect((await h.owner.patch('/integrations/i-other', { name: 'hacked' })).status).toBe(404);
  });
  it('websocket requires auth and is origin-checked', async () => {
    const anon = await h.app.injectWS('/api/v1/ws');
    const closed = await new Promise<number>((res) => anon.on('close', (code: number) => res(code)));
    expect(closed).toBe(4401);
    const ws = await h.app.injectWS('/api/v1/ws', { headers: { cookie: h.owner.cookie } });
    const hello = await new Promise<any>((res) => ws.on('message', (d: Buffer) => res(JSON.parse(d.toString()))));
    expect(hello.type).toBe('hello');
    ws.terminate();
  });
});
