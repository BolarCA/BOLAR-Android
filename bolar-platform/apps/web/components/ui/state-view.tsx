'use client';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { Button } from './index';
import { RequestAccessPanel } from '../access-denied/request-access';

/**
 * Every screen must render loading, empty, error, denied and review-required states (blueprint p36).
 * Pass the React Query result and the success renderer; StateView picks the state.
 */
export function StateView<T>({ isLoading, error, data, isEmpty, empty, children, onRetry, resource, skeleton = 'list' }: {
  isLoading: boolean; error: unknown; data: T | undefined; isEmpty?: (d: T) => boolean;
  empty?: { title: string; description?: string; action?: ReactNode };
  children: (d: T) => ReactNode; onRetry?: () => void;
  /** Resource reference used by the review-required state to pre-fill an access request. */
  resource?: { type: string; id: string; classification?: 'confidential' | 'restricted' };
  skeleton?: 'list' | 'cards' | 'detail';
}) {
  if (isLoading) return <Skeleton kind={skeleton} />;
  if (error) {
    if (error instanceof ApiError && error.isReviewRequired) return <ReviewRequired resource={resource} />;
    if (error instanceof ApiError && (error.isDenied || error.isNotFound)) return <Denied />;
    return <ErrorState error={error} onRetry={onRetry} />;
  }
  if (data === undefined) return <Skeleton kind={skeleton} />;
  if (isEmpty?.(data)) return <EmptyState {...(empty ?? { title: 'Nothing here yet' })} />;
  return <>{children(data)}</>;
}

export function Skeleton({ kind = 'list' }: { kind?: 'list' | 'cards' | 'detail' }) {
  const rows = kind === 'cards' ? 3 : kind === 'detail' ? 6 : 5;
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={kind === 'cards' ? 'grid gap-4 sm:grid-cols-3' : 'space-y-3'}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => <div key={i} aria-hidden className={kind === 'cards' ? 'h-28 animate-pulse rounded-[14px] bg-navy-100' : 'h-12 animate-pulse rounded-lg bg-navy-100'} />)}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div data-state="empty" className="rounded-[14px] border border-dashed border-line bg-surface p-10 text-center">
      <p className="text-lg font-semibold text-navy-900">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof ApiError ? error.body.requestId : null;
  return (
    <div data-state="error" role="alert" className="rounded-[14px] border border-danger-100 bg-danger-100/50 p-6">
      <p className="font-semibold text-navy-900">Something went wrong</p>
      <p className="mt-1 text-sm text-ink">{error instanceof Error ? error.message : 'Unknown error'}</p>
      {requestId && <p className="mt-1 text-xs text-muted">Reference: {requestId}</p>}
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Denied() {
  return (
    <div data-state="denied" role="alert" className="rounded-[14px] border border-line bg-surface p-8 text-center">
      <p className="text-lg font-semibold text-navy-900">You don&apos;t have access to this</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">Your role doesn&apos;t include this area, or the record isn&apos;t shared with you. If you believe this is a mistake, ask your administrator to adjust your role or relationships.</p>
      <p className="mt-4 text-xs text-muted">Need help? Contact support and quote the time of this attempt.</p>
    </div>
  );
}

export function ReviewRequired({ resource }: { resource?: { type: string; id: string; classification?: 'confidential' | 'restricted' } }) {
  return (
    <div data-state="review-required" className="rounded-[14px] border border-violet-100 bg-violet-100/40 p-6">
      <p className="text-lg font-semibold text-navy-900">Approval required for sensitive data</p>
      <p className="mt-1 text-sm text-ink">This record is classified. Request time-boxed access with a business purpose; an approver will be notified and every access is audited.</p>
      {resource && <RequestAccessPanel resource={resource} />}
    </div>
  );
}
