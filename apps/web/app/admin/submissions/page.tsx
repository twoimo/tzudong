import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata({
    title: '제보 관리 - 관리자 콘솔 - 쯔동여지도',
});

export const dynamic = 'force-dynamic';

export default function AdminSubmissionsRedirect() {
    redirect('/admin?module=submissions');
}
