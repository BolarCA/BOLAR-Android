import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { AssistantLauncher } from '@/components/assistant/assistant-launcher';

export default function PortalsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <AssistantLauncher />
    </>
  );
}
