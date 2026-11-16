'use client';
import { useParams } from 'next/navigation';
import { VendorDetail } from '@/components/work-order-board/vendor-detail';
export default function Page() { const { id } = useParams<{ id: string }>(); return <VendorDetail id={id} />; }
