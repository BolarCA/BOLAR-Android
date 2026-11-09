'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from './index';

export interface BottomNavItem { label: string; href: string; icon: ReactNode; /** Matches nested routes too (e.g. /tenant/pay/*) */ exact?: boolean }

/**
 * Mobile bottom navigation (blueprint p48): fixed to the viewport bottom below the `lg` breakpoint, hidden on
 * desktop where the sidebar takes over. Every item is at least 56px tall (WCAG 2.5.8 target size, BOLAR "large tap
 * targets"), the active item carries `aria-current="page"`, and the landmark has its own label so it never collides
 * with the shell's "Primary" navigation.
 */
export function BottomNav({ items, label, className }: { items: BottomNavItem[]; label: string; className?: string }) {
  const pathname = usePathname();
  const isActive = (item: BottomNavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/'));
  return (
    <nav aria-label={label} data-testid="bottom-nav" className={cn('fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface shadow-[0_-4px_16px_rgba(11,31,58,0.08)] lg:hidden', className)} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="grid auto-cols-fr grid-flow-col">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold', active ? 'text-cobalt-700' : 'text-navy-700 hover:text-cobalt-600')}>
                <span aria-hidden className={cn('flex h-7 w-11 items-center justify-center rounded-full', active && 'bg-cobalt-100')}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Simple line icons (currentColor) so the nav needs no icon library. */
export const NavIcons = {
  home: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>,
  pay: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></svg>,
  wrench: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.7-6.7z" /><path d="M9 15l-5 5" /></svg>,
  doc: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>,
  user: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
};
