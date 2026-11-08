import { DEFAULT_DEPARTMENTS, type UserDTO, type UserRole } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../lib/errors.js';
import { csrfFor, hashPassword, newToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { newId } from '../../lib/util.js';

export interface AuthContext {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  locale: string;
  workspaceId: string;
  sessionToken: string;
  csrf: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const userDTO = (a: Pick<AuthContext, 'userId' | 'username' | 'displayName' | 'role' | 'locale'>): UserDTO => ({
  id: a.userId, username: a.username, displayName: a.displayName, role: a.role, locale: a.locale,
});

// A fixed hash so unknown usernames cost the same time as wrong passwords.
let dummyHash: Promise<string> | null = null;

export class AuthService {
  private readonly failures = new Map<string, number[]>();
  constructor(private readonly ctx: () => AppContext) {}

  async resolve(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const c = this.ctx();
    const s = await c.db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!s || s.expiresAt.getTime() <= c.clock.now().getTime() || s.user.disabled) return null;
    const m = await c.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: s.workspaceId, userId: s.userId } } });
    if (!m) return null;
    if (c.clock.now().getTime() - s.lastUsedAt.getTime() > 60_000) await c.db.session.update({ where: { id: s.id }, data: { lastUsedAt: c.clock.now() } });
    return { userId: s.userId, username: s.user.username, displayName: s.user.displayName, role: m.role, locale: s.user.locale, workspaceId: s.workspaceId, sessionToken: token, csrf: csrfFor(token, c.config.encryptionKey) };
  }

  async setupRequired(): Promise<boolean> {
    return (await this.ctx().db.user.count()) === 0;
  }

  async setup(body: { username: string; password: string; displayName?: string | undefined; workspaceName?: string | undefined }, ip?: string) {
    const c = this.ctx();
    if (!(await this.setupRequired())) throw new ApiError('conflict', 'Setup is already complete');
    const passwordHash = await hashPassword(body.password);
    const userId = newId(), workspaceId = newId();
    try {
      await c.db.$transaction(async (tx) => {
        if ((await tx.user.count()) > 0) throw new ApiError('conflict', 'Setup is already complete');
        await tx.workspace.create({ data: { id: workspaceId, name: body.workspaceName ?? 'Azhiim Virtual Office', slug: `ws-${workspaceId.slice(0, 8)}` } });
        await tx.user.create({ data: { id: userId, username: body.username, displayName: body.displayName ?? body.username, passwordHash } });
        await tx.workspaceMember.create({ data: { id: newId(), workspaceId, userId, role: 'OWNER' } });
        await tx.department.createMany({ data: DEFAULT_DEPARTMENTS.map((d) => ({ id: newId(), workspaceId, key: d.key, name: d.name, color: d.color, homeRoom: d.homeRoom })) });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw e;
    }
    await c.audit.log({ workspaceId, actorUserId: userId, action: 'auth.setup', entity: 'user', entityId: userId, ...(ip ? { ip } : {}) });
    return this.createSession(userId, workspaceId);
  }

  private async createSession(userId: string, workspaceId: string) {
    const c = this.ctx();
    const token = newToken();
    const now = c.clock.now();
    await c.db.session.create({ data: { id: newId(), userId, workspaceId, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + c.config.sessionTtlMs), lastUsedAt: now } });
    const auth = await this.resolve(token);
    return { token, auth: auth! };
  }

  private recentFailures(key: string): number {
    const now = this.ctx().clock.now().getTime();
    const w = this.ctx().config.loginWindowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < w);
    this.failures.set(key, list);
    return list.length;
  }

  async login(username: string, password: string, ip?: string) {
    const c = this.ctx();
    const key = `${ip ?? '?'}:${username.toLowerCase()}`;
    if (this.recentFailures(key) >= c.config.loginMaxAttempts) throw new ApiError('rate_limited', 'Too many failed attempts. Try again later.');
    const user = await c.db.user.findUnique({ where: { username } });
    dummyHash ??= hashPassword('not-a-real-password');
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok || user.disabled) {
      this.failures.get(key)!.push(c.clock.now().getTime());
      await c.audit.log({ action: 'auth.login_failed', details: { username }, ...(ip ? { ip } : {}) });
      throw new ApiError('unauthenticated', 'Invalid username or password');
    }
    const m = await c.db.workspaceMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    if (!m) throw new ApiError('forbidden', 'This account has no workspace');
    this.failures.delete(key);
    await c.audit.log({ workspaceId: m.workspaceId, actorUserId: user.id, action: 'auth.login', ...(ip ? { ip } : {}) });
    return this.createSession(user.id, m.workspaceId);
  }

  async logout(token: string | undefined, auth: AuthContext | null): Promise<void> {
    if (!token) return;
    const c = this.ctx();
    await c.db.session.deleteMany({ where: { tokenHash: sha256(token) } });
    if (auth) await c.audit.log({ workspaceId: auth.workspaceId, actorUserId: auth.userId, action: 'auth.logout' });
  }
}
