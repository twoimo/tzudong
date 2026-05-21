import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { noIndexMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';
import { MyPageLayoutContent } from './mypage-layout-content';

export const metadata: Metadata = noIndexMetadata;

export default function MyPageLayout({ children }: { children: ReactNode }) {
    return (
        <AppRuntimeLayout>
            <MyPageLayoutContent>{children}</MyPageLayoutContent>
        </AppRuntimeLayout>
    );
}
