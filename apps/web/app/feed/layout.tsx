import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildPublicMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = buildPublicMetadata({
    title: '피드 - 쯔동여지도',
    description: '쯔양 맛집 지도에서 올라오는 맛집 리뷰와 활동을 한눈에 확인하세요.',
    path: '/feed',
    keywords: ['쯔양 맛집 피드', '맛집 리뷰', '쯔동여지도'],
});

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
