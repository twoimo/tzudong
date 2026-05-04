import type { ReactNode } from 'react';
import { AppRuntimeLayout } from '../app-runtime-layout';

export default function SegmentLayout({ children }: { children: ReactNode }) {
    return <AppRuntimeLayout>{children}</AppRuntimeLayout>;
}
