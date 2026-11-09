'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getActAsOrg, setActAsOrg } from '@/lib/api-client';
import { portalForPath, portalsForRoles, type PortalDef } from '@/lib/nav';
import { Button, cn } from '../ui';
import { Denied, Skeleton } from '../ui/state-view';

/** Shared app shell: skip link, sidebar, topbar, portal switcher, role gating (blueprint p36). */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, status, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actAs, setActAs] = useState<string | null>(null);
  const qc = useQueryClient();
  const portal = portalForPath(pathname);

  useEffect(() => { setActAs(getActAsOrg()); }, [pathname]);
  // Leaving "act as org" clears the stored target and reloads so every cached query is re-fetched in the home org.
  const stopActing = () => { setActAsOrg(null); qc.clear(); window.location.assign('/admin'); };

  useEffect(() => { if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`); }, [status, pathname, router]);
  useEffect(() => { setOpen(false); }, [pathname]);

  if (status !== 'authenticated' || !me) return <div className="p-8"><Skeleton kind="detail" /></div>;
  const roles = me.roles.map((r) => r.role as string);
  // Same portals the API grants (me.portals), ordered by its canonical landing order so the switcher matches the redirect.
  const allowed = portalsForRoles(roles).sort((a, b) => me.portals.indexOf(a.base) - me.portals.indexOf(b.base));
  const canEnter = portal ? allowed.some((p) => p.key === portal.key) : false;

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={cn('fixed inset-y-0 left-0 z-30 w-64 transform bg-navy-900 text-white transition lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-2 px-5">
          <span aria-hidden className="h-8 w-8 rounded-lg bg-gradient-to-br from-cobalt-500 via-teal-500 to-violet-500" />
          <span className="text-lg font-bold tracking-tight">BOLAR</span>
        </div>
        <nav className="px-3" aria-label="Primary">
          {portal && canEnter && (
            <>
              <p className="px-2 pb-2 pt-3 text-xs uppercase tracking-wide text-navy-200">{portal.title}</p>
              <ul className="space-y-1">
                {portal.nav.filter((n) => !n.permission || me.permissions.includes(n.permission as never)).map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={pathname === n.href ? 'page' : undefined} className={cn('block rounded-lg px-3 py-2 text-sm', pathname === n.href ? 'bg-cobalt-500 text-white' : 'text-navy-100 hover:bg-navy-700')}>{n.label}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {allowed.length > 1 && (
            <>
              <p className="px-2 pb-2 pt-6 text-xs uppercase tracking-wide text-navy-200">Portals</p>
              <ul className="space-y-1">
                {allowed.map((p) => <li key={p.key}><Link href={p.base} className={cn('block rounded-lg px-3 py-2 text-sm', portal?.key === p.key ? 'text-white' : 'text-navy-100 hover:bg-navy-700')}>{p.title}</Link></li>)}
              </ul>
            </>
          )}
        </nav>
      </aside>
      {open && <button aria-label="Close navigation" className="fixed inset-0 z-20 bg-navy-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-line bg-surface px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="lg:hidden" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>☰</Button>
            <Breadcrumbs pathname={pathname} portal={portal} />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{me.org.name}</span>
            <span className="text-sm font-medium">{me.actor.name}</span>
            <Button variant="secondary" onClick={() => void logout().then(() => router.replace('/login'))}>Sign out</Button>
          </div>
        </header>
        {(me.supportSessionId || actAs) && (
          <div role="status" data-testid="support-banner" className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-orange-100/70 px-4 py-2 text-sm text-navy-900 lg:px-8">
            <p>
              <span className="font-semibold">{me.supportSessionId ? 'Support session active' : 'Acting as organization'}:</span> you are working inside <span className="font-semibold">{me.org.name}</span>{actAs ? ` (${actAs})` : ''}. Every request is audited{me.supportSessionId ? ' against this support session' : ''}.
            </p>
            {actAs && <Button variant="secondary" onClick={stopActing}>Stop acting as org</Button>}
          </div>
        )}
        <main id="main" tabIndex={-1} className="flex-1 p-4 lg:p-8">
          {portal && !canEnter ? <Denied /> : children}
        </main>
      </div>
    </div>
  );
}

function Breadcrumbs({ pathname, portal }: { pathname: string; portal?: PortalDef }) {
  const parts = pathname.split('/').filter(Boolean);
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex items-center gap-2">
        <li><Link href={portal?.base ?? '/'} className="hover:underline">{portal?.title ?? 'Home'}</Link></li>
        {parts.slice(1).map((p, i) => (
          <li key={i} className="flex items-center gap-2"><span aria-hidden>/</span><span className="capitalize text-ink">{decodeURIComponent(p).replace(/-/g, ' ')}</span></li>
        ))}
      </ol>
    </nav>
  );
}
