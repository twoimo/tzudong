import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildPublicMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = buildPublicMetadata({
    title: '쯔양 맛집 인사이트',
    description: '쯔양 맛집 데이터의 지역, 카테고리, 방문 흐름 인사이트를 확인하세요.',
    path: '/insights',
    keywords: ['쯔양 맛집 분석', '맛집 인사이트', '쯔동여지도'],
});

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
