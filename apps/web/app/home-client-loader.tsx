'use client';

import dynamic from 'next/dynamic';
import { GlobalLoader } from '@/components/ui/global-loader';

const HomeClient = dynamic(() => import('./home-client'), {
    ssr: false,
    loading: () => (
        <GlobalLoader
            message="로딩 중..."
            subMessage="잠시만 기다려주세요"
            fullScreen
        />
    ),
});

export default function HomeClientLoader() {
    return <HomeClient />;
}
