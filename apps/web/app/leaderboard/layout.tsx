import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildPublicMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = buildPublicMetadata({
    title: '랭킹 - 쯔동여지도',
    description: '쯔양 맛집 방문과 리뷰 활동을 기준으로 한 쯔동여지도 랭킹을 확인하세요.',
    path: '/leaderboard',
    keywords: ['쯔동여지도 랭킹', '맛집 랭킹', '쯔양 맛집'],
});

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
