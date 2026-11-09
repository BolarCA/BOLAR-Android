import { PropertiesList } from '@/components/property/properties-list';
export default function Page() {
  return <PropertiesList basePath="/owner/properties" readOnly title="My properties" description="Properties you own, with occupancy at a glance. Read-only: your property manager maintains units and status." />;
}
