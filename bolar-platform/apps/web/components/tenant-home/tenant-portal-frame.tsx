'use client';
import type { ReactNode } from 'react';
import { BottomNav, NavIcons } from '@/components/ui/bottom-nav';

/** Resident portal tabs (blueprint p48 bottom nav). Mirrors the `tenant` entry in lib/nav.ts so the sidebar and the bar agree. */
const TENANT_TABS = [
  { label: 'Home', href: '/tenant', icon: NavIcons.home, exact: true },
  { label: 'Pay', href: '/tenant/pay', icon: NavIcons.pay },
  { label: 'Maintenance', href: '/tenant/maintenance', icon: NavIcons.wrench },
  { label: 'Documents', href: '/tenant/documents', icon: NavIcons.doc },
  { label: 'Profile', href: '/tenant/profile', icon: NavIcons.user },
];

/**
 * Wraps every resident screen: reserves space for the fixed bottom bar on small screens so the last card and any
 * page-level action never hide behind it, and renders the bar itself. Desktop keeps the shell sidebar only.
 */
export function TenantPortalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pb-24 lg:pb-0">
      {children}
      <BottomNav label="Resident" items={TENANT_TABS} />
    </div>
  );
}
