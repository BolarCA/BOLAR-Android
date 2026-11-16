'use client';
import { useParams } from 'next/navigation';
import { CaseDetail } from '@/components/legal/case-detail';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CaseDetail id={id} />;
}
