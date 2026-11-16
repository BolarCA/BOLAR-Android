import type { ReactNode } from 'react';
import { TenantPortalFrame } from '@/components/tenant-home/tenant-portal-frame';

/** Resident portal: every screen gets the mobile bottom navigation and the bottom padding it needs. */
export default function TenantLayout({ children }: { children: ReactNode }) {
  return <TenantPortalFrame>{children}</TenantPortalFrame>;
}
