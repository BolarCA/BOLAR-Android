'use client';
import { useParams } from 'next/navigation';
import { VendorJobDetail } from '@/components/work-order-board/vendor-jobs';
export default function Page() { const { id } = useParams<{ id: string }>(); return <VendorJobDetail id={id} />; }
