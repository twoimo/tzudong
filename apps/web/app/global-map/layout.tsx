import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildPublicMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = buildPublicMetadata({
    title: '국내·해외 맛집 지도 - 쯔동여지도',
    description: '쯔양 유튜브에 나온 국내와 해외 맛집을 지도에서 지역별로 찾아보세요.',
    path: '/global-map',
    keywords: ['쯔양 해외 맛집', '쯔양 국내 맛집', '맛집 지도'],
});

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
