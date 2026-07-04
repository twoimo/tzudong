import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildNoIndexMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';
import { MyPageLayoutContent } from './mypage-layout-content';

export const metadata: Metadata = buildNoIndexMetadata({
    title: '마이페이지 - 쯔동여지도',
});

export default function MyPageLayout({ children }: { children: ReactNode }) {
    return (
        <AppRuntimeLayout>
            <MyPageLayoutContent>{children}</MyPageLayoutContent>
        </AppRuntimeLayout>
    );
}
