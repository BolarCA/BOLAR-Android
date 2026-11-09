import { PropertyDetail } from '@/components/property/property-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PropertyDetail id={id} basePath="/owner/properties" readOnly />;
}
