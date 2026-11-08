import type { FastifyInstance, FastifyReply } from 'fastify';
import { LoginBodySchema, SESSION_COOKIE, SetupBodySchema } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../lib/errors.js';
import { parse } from '../../lib/util.js';
import { originAllowed, type Guard } from './guard.js';
import { userDTO, type AuthService } from './auth-service.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: () => AppContext, auth: AuthService, guard: Guard): void {
  const setCookie = (reply: FastifyReply, token: string) => {
    const c = ctx();
    void reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: c.config.cookieSecure, maxAge: Math.floor(c.config.sessionTtlMs / 1000) });
  };
  const workspaceOf = async (id: string) => {
    const w = await ctx().db.workspace.findUniqueOrThrow({ where: { id } });
    return { id: w.id, name: w.name };
  };

  app.get('/auth/status', async (req) => {
    const a = await auth.resolve(req.cookies[SESSION_COOKIE]);
    return { setupRequired: await auth.setupRequired(), authenticated: !!a, ...(a ? { user: userDTO(a) } : {}) };
  });

  app.post('/auth/setup', async (req, reply) => {
    if (!originAllowed(req, ctx())) throw new ApiError('forbidden', 'Cross-origin request rejected');
    const body = parse(SetupBodySchema, req.body);
    const { token, auth: a } = await auth.setup(body, req.ip);
    setCookie(reply, token);
    reply.code(201);
    return { user: userDTO(a), csrfToken: a.csrf, workspace: await workspaceOf(a.workspaceId) };
  });

  app.post('/auth/login', async (req, reply) => {
    if (!originAllowed(req, ctx())) throw new ApiError('forbidden', 'Cross-origin request rejected');
    const body = parse(LoginBodySchema, req.body);
    const { token, auth: a } = await auth.login(body.username, body.password, req.ip);
    setCookie(reply, token);
    return { user: userDTO(a), csrfToken: a.csrf, workspace: await workspaceOf(a.workspaceId) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const a = await auth.resolve(token);
    if (a) await guard()(req); // CSRF applies to logout of a live session
    await auth.logout(token, a);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: guard() }, async (req) => {
    const a = req.auth!;
    return { user: userDTO(a), csrfToken: a.csrf, workspace: await workspaceOf(a.workspaceId) };
  });
}
