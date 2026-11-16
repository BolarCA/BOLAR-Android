'use client';
import { usePathname } from 'next/navigation';
import { portalForPath } from '@/lib/nav';
import { PageHeader } from '@/components/ui';
import { EmptyState } from '@/components/ui/state-view';

/** Empty onboarding state for portals whose domain screens land in later build days. */
export function PortalLanding({ nextStep }: { nextStep: string }) {
  const portal = portalForPath(usePathname());
  return (
    <>
      <PageHeader title={portal?.title ?? 'Portal'} description={portal?.description} />
      <EmptyState title="Nothing to show yet" description={nextStep} />
    </>
  );
}
