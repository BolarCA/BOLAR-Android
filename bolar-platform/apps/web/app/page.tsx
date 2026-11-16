'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/state-view';

export default function Home() {
  const { status, me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    if (status === 'authenticated' && me) router.replace(me.portals[0] ?? '/login');
  }, [status, me, router]);
  return <div className="p-8"><Skeleton kind="detail" /></div>;
}
