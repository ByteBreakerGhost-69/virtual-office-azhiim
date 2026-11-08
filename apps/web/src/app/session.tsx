import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can as canRole, type Action, type UserDTO } from '@avo/shared';
import { api, setCsrf } from '../lib/api.js';
import type { AuthStatus, Me } from '../lib/queries.js';
import { useRealtime } from '../lib/ws.js';
import { Loading } from '../components/ui.js';

interface Session {
  user: UserDTO;
  workspaceName: string;
  can: (a: Action) => boolean;
  live: boolean;
  logout: () => Promise<void>;
}
const Ctx = createContext<Session | null>(null);
export const useSession = (): Session => {
  const v = useContext(Ctx);
  if (!v) throw new Error('no session');
  return v;
};

export function useAuthStatus() {
  return useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthStatus>('/auth/status'), staleTime: 0, retry: false });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), retry: false });
  useEffect(() => {
    if (me.data) setCsrf(me.data.csrfToken);
  }, [me.data]);
  const { live } = useRealtime(!!me.data);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setCsrf(null);
    qc.clear();
    await qc.invalidateQueries({ queryKey: ['auth'] });
  }, [qc]);

  const value = useMemo<Session | null>(() => {
    if (!me.data) return null;
    const u = me.data.user;
    return { user: u, workspaceName: me.data.workspace.name, can: (a) => canRole(u.role, a), live, logout };
  }, [me.data, live, logout]);

  if (me.isLoading) return <Loading />;
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
