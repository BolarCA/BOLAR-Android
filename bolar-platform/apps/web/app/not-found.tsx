import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="max-w-md rounded-[14px] border border-line bg-surface p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-navy-900">This page does not exist</h1>
        <p className="mt-2 text-sm text-muted">The link may be outdated, or the screen belongs to a portal you do not have access to.</p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-cobalt-500 px-4 text-sm font-semibold text-white hover:bg-cobalt-600">Go to my portal</Link>
      </div>
    </main>
  );
}
