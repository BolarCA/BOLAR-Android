import { TenantDetail } from '@/components/tenant-profile/tenant-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantDetail id={id} />;
}
