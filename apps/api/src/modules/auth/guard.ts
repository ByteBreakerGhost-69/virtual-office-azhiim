import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, CSRF_HEADER, SESSION_COOKIE, type Action } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../lib/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import type { AuthService } from './auth-service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function originAllowed(req: FastifyRequest, ctx: AppContext): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; the CSRF token still applies to authenticated calls
  if (ctx.config.corsOrigins.includes(origin)) return true;
  const host = req.headers.host;
  return !!host && (origin === `http://${host}` || origin === `https://${host}`);
}

/** Returns a Fastify preHandler: session -> origin -> CSRF -> RBAC. Backend-enforced, never UI-only. */
export function makeGuard(app: FastifyInstance, ctx: () => AppContext, auth: AuthService) {
  return (action?: Action) =>
    async (req: FastifyRequest): Promise<void> => {
      const c = ctx();
      const token = req.cookies[SESSION_COOKIE];
      const a = await auth.resolve(token);
      if (!a) throw new ApiError('unauthenticated', 'Sign in required');
      if (MUTATING.has(req.method)) {
        if (!originAllowed(req, c)) throw new ApiError('forbidden', 'Cross-origin request rejected');
        const sent = req.headers[CSRF_HEADER];
        if (typeof sent !== 'string' || !safeEqual(sent, a.csrf)) throw new ApiError('forbidden', 'Missing or invalid CSRF token');
      }
      if (action && !can(a.role, action)) throw new ApiError('forbidden', `Your role (${a.role}) cannot perform "${action}"`);
      req.auth = a;
    };
}
export type Guard = ReturnType<typeof makeGuard>;
void (null as unknown as FastifyInstance);
