import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata({
    title: '맛집 관리 - 관리자 콘솔 - 쯔동여지도',
});

export default function AdminEvaluationsLayout({ children }: { children: ReactNode }) {
    return children;
}
