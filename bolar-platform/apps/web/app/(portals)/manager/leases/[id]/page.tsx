import { LeaseWorkspace } from '@/components/lease-review/lease-workspace';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeaseWorkspace id={id} />;
}
