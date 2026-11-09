'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { Button, Input, Alert } from '@/components/ui';

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [needsOrg, setNeedsOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const me = await login({ email, password, ...(orgSlug ? { orgSlug } : {}) });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : (me.portals[0] ?? '/'));
    } catch (err) {
      if (err instanceof ApiError && err.body.fieldErrors?.some((f) => f.path === 'body.orgSlug')) { setNeedsOrg(true); setError('This email belongs to more than one organization. Enter your organization slug.'); }
      else setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-describedby={error ? 'login-error' : undefined}>
      <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Password" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      {needsOrg && <Input label="Organization slug" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} hint="For example: demo-pm" />}
      {error && <div id="login-error"><Alert tone="danger" title={error} /></div>}
      <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md rounded-[14px] bg-surface p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="h-10 w-10 rounded-xl bg-gradient-to-br from-cobalt-500 via-teal-500 to-violet-500" />
          <div><h1 className="text-xl font-bold text-navy-900">Sign in to BOLAR</h1><p className="text-sm text-muted">Secure by design. Every access is audited.</p></div>
        </div>
        <Suspense fallback={null}><LoginForm /></Suspense>
      </div>
    </main>
  );
}
