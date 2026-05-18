'use client';

import dynamic from 'next/dynamic';
import { GlobalLoader } from '@/components/ui/global-loader';

const HomeClient = dynamic(() => import('./home-client'), {
    ssr: false,
    loading: () => (
        <GlobalLoader
            message="홈 지도를 불러오는 중..."
            subMessage="맛집 지도 런타임을 준비하고 있습니다"
            fullScreen
        />
    ),
});

export default function HomeClientLoader() {
    return <HomeClient />;
}
