import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildPublicMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = buildPublicMetadata({
    title: '쯔동여지도 도장 - 쯔양이 다녀간 맛집 지도',
    description: '쯔양이 다녀간 맛집 방문 기록과 도장 깨기 현황을 확인하세요.',
    path: '/stamp',
    keywords: ['쯔양 맛집 도장', '맛집 방문 기록', '쯔동여지도'],
});

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
