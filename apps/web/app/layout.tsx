import type { Metadata } from "next";
import { RootSpeedInsights } from "./root-speed-insights";
import "./globals.css";

// 카카오톡 OG 이미지 표시를 위해 절대 URL 필요
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tzudong.vercel.app';
const supabasePreconnectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const shouldPreconnectSupabase = Boolean(supabasePreconnectUrl && /^https?:\/\//i.test(supabasePreconnectUrl));
export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: "쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!",
    description: "쯔양 유튜브에 나온 전국 맛집을 지도에서 한눈에! 영상 보기, 리뷰, 도장 깨기까지",
    icons: {
        icon: [
            { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
            { url: '/favicon.ico', sizes: 'any' },
        ],
        apple: [
            { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
    },
    openGraph: {
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
        description: '쯔양 유튜브에 나온 전국 맛집을 지도에서 한눈에! 영상 보기, 리뷰, 도장 깨기까지',
        url: siteUrl,
        type: 'website',
        locale: 'ko_KR',
        siteName: '쯔동여지도',
        images: [
            {
                url: '/og-image-20260213.png',
                width: 1200,
                height: 630,
                alt: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
        description: '쯔양 유튜브에 나온 전국 맛집을 지도에서 한눈에! 영상 보기, 리뷰, 도장 깨기까지',
        images: ['/og-image-20260213.png'],
    },
};

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="ko"
            suppressHydrationWarning
        >
            <head>
                {/* [PERF] 네트워크 최적화: 초기 렌더에 필요한 도메인만 Preconnect (TCP+TLS 핸드쉐이크 선행) */}
                {/* Supabase API - 데이터 페칭 핵심 */}
                {shouldPreconnectSupabase ? (
                    <link rel="preconnect" href={supabasePreconnectUrl} crossOrigin="anonymous" />
                ) : null}
                {/* 네이버 지도 - SDK 스크립트 호스트만 선연결하고, 지연 로드되는 보조 지도 도메인은 DNS 조회만 선행 */}
                <link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />
                {/* YouTube 썸네일 - LCP 개선 */}
                <link rel="dns-prefetch" href="https://img.youtube.com" />
                {/* DNS Prefetch - 보조 도메인 (preconnect보다 가볍고 빠름) */}
                <link rel="dns-prefetch" href="https://openapi.map.naver.com" />
                <link rel="dns-prefetch" href="https://ssl.pstatic.net" />
                <link rel="dns-prefetch" href="https://nrbe.pstatic.net" />
                <link rel="dns-prefetch" href="//nrbe.map.naver.net" />
                <link rel="dns-prefetch" href="//static.naver.net" />
                <link rel="dns-prefetch" href="https://i.ytimg.com" />
                <link rel="dns-prefetch" href="https://lh3.googleusercontent.com" />
            </head>
            <body suppressHydrationWarning>
                <script src="/scripts/viewport-height-fix.js" defer />
                {children}
                <RootSpeedInsights />
            </body>
        </html>
    );
}
