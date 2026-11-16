import { PropertiesList } from '@/components/property/properties-list';
export default function Page() {
  return <PropertiesList basePath="/manager/properties" title="Properties" description="Portfolio, buildings and units you manage. Filters run server-side; every change is audited." />;
}
