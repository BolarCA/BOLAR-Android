'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCan } from '@/lib/auth';
import { contextFromLocation, type AiContextDto } from '@/lib/hooks/ai';
import { AssistantDrawer } from './assistant-drawer';

/** Floating entry point rendered by the portals layout; only for actors with ai:use. Context comes from the current page. */
export function AssistantLauncher() {
  const canUse = useCan('ai:use');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<AiContextDto>({});
  // Following a source or draft link navigates to the record page; close the drawer so the page itself is in focus.
  useEffect(() => { setOpen(false); }, [pathname]);
  if (!canUse) return null;
  const openDrawer = () => { setContext(contextFromLocation(pathname, typeof window === 'undefined' ? '' : window.location.search)); setOpen(true); };
  return (
    <>
      {!open && (
        <button type="button" onClick={openDrawer} aria-label="Open assistant" className="fixed bottom-20 right-4 z-30 inline-flex min-h-11 items-center gap-2 rounded-full bg-navy-900 px-4 text-sm font-semibold text-white shadow-lg hover:bg-navy-700 lg:bottom-6 lg:right-6">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-cobalt-500 via-teal-500 to-violet-500" />
          Assistant
        </button>
      )}
      <AssistantDrawer open={open} onClose={() => setOpen(false)} context={context} />
    </>
  );
}
