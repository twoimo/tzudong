import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { noIndexMetadata } from '@/lib/seo';
import { AppRuntimeLayout } from '../app-runtime-layout';

export const metadata: Metadata = noIndexMetadata;

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
