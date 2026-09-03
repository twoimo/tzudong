import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { buildNoIndexMetadata } from '@/lib/seo';
import { ADMIN_THEME_PRELUDE_SOURCE } from '@/lib/admin/admin-theme-prelude';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = buildNoIndexMetadata({
    title: '관리자 콘솔 - 쯔동여지도',
});

export default async function SegmentLayout({ children }: { children: ReactNode }) {
    const nonce = (await headers()).get("x-nonce") ?? undefined;

    return (
        <>
            <script
                nonce={nonce}
                suppressHydrationWarning
                dangerouslySetInnerHTML={{ __html: ADMIN_THEME_PRELUDE_SOURCE }}
            />
            <AppRuntimeLayout>{children}</AppRuntimeLayout>
        </>
    );
}
