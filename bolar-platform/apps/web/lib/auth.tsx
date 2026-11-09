'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponseDto } from '@bolar/contracts';
import { ApiError, authApi, hasRefreshToken, setTokens } from './api-client';

interface AuthState {
  me: MeResponseDto | null;
  status: 'loading' | 'anonymous' | 'authenticated';
  login: (input: { email: string; password: string; orgSlug?: string }) => Promise<{ me: MeResponseDto; mfaRequired: boolean }>;
  /** Completes login-time step-up for users with MFA enabled (POST /auth/mfa/verify). */
  verifyMfa: (code: string) => Promise<MeResponseDto>;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function AuthInner({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [booted, setBooted] = useState(false);
  // Session discovery runs after hydration; until then status is 'loading' so guards never redirect on first paint.
  useEffect(() => { setEnabled(hasRefreshToken()); setBooted(true); }, []);
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.me(),
    enabled,
    retry: (count, err) => !(err instanceof ApiError && err.isUnauthenticated) && count < 1,
    staleTime: 60_000,
  });
  const login = useCallback(async (input: { email: string; password: string; orgSlug?: string }) => {
    const res = await authApi.login(input);
    setTokens(res, res.org.slug);
    setEnabled(true);
    const me = await authApi.me();
    qc.setQueryData(['me'], me);
    return { me, mfaRequired: res.mfaRequired };
  }, [qc]);
  const verifyMfa = useCallback(async (code: string) => {
    const tokens = await authApi.verifyMfa(code);
    setTokens(tokens);
    const me = await authApi.me();
    qc.setQueryData(['me'], me);
    return me;
  }, [qc]);
  const logout = useCallback(async () => {
    await authApi.logout();
    qc.clear();
    setEnabled(false);
  }, [qc]);
  const value = useMemo<AuthState>(() => ({
    me: meQuery.data ?? null,
    status: !booted ? 'loading' : !enabled || (meQuery.isError && meQuery.error instanceof ApiError && meQuery.error.isUnauthenticated) ? 'anonymous' : meQuery.data ? 'authenticated' : meQuery.isError ? 'anonymous' : 'loading',
    login,
    verifyMfa,
    logout,
    refetch: async () => { await meQuery.refetch(); },
  }), [booted, enabled, meQuery, login, verifyMfa, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) && count < 2, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthInner>{children}</AuthInner>
    </QueryClientProvider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within Providers');
  return ctx;
}

export function useCan(permission: string): boolean {
  const { me } = useAuth();
  return Boolean(me?.permissions.includes(permission as never));
}
