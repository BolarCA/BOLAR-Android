'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi, ApiError } from '@/lib/api-client';
import { Button, Input, Alert } from '@/components/ui';

function AcceptForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (!token) return <Alert tone="danger" title="This invitation link is missing its token." />;
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setLoading(true); setError(null);
      try { const r = await authApi.acceptInvite({ token, name, password }); router.replace(`/login?accepted=1&org=${r.orgSlug}`); }
      catch (err) { setError(err instanceof ApiError ? (err.isNotFound ? 'This invitation is invalid or has expired.' : err.message) : 'Could not accept invitation'); }
      finally { setLoading(false); }
    }}>
      <Input label="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Choose a password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 12 characters." />
      {error && <Alert tone="danger" title={error} />}
      <Button type="submit" className="w-full" loading={loading}>Create account</Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md rounded-[14px] bg-surface p-8 shadow-xl">
        <h1 className="mb-6 text-xl font-bold text-navy-900">Accept your BOLAR invitation</h1>
        <Suspense fallback={null}><AcceptForm /></Suspense>
      </div>
    </main>
  );
}
