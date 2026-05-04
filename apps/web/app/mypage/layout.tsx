import type { ReactNode } from 'react';
import { AppRuntimeLayout } from '../app-runtime-layout';
import { MyPageLayoutContent } from './mypage-layout-content';

export default function MyPageLayout({ children }: { children: ReactNode }) {
    return (
        <AppRuntimeLayout>
            <MyPageLayoutContent>{children}</MyPageLayoutContent>
        </AppRuntimeLayout>
    );
}
