'use client';

import dynamic from 'next/dynamic';
import { GlobalLoader } from '@/components/ui/global-loader';

const HomeClient = dynamic(() => import('./home-client'), {
    ssr: false,
    loading: () => (
        <GlobalLoader
            message="쯔동여지도 로딩 중..."
            subMessage=""
            fullScreen
        />
    ),
});

export default function HomeClientLoader() {
    return <HomeClient />;
}
