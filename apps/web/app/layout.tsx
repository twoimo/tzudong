import type { Metadata } from "next";
import { Noto_Serif_KR } from "next/font/google";
import Script from "next/script";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { QueryProvider } from "./providers";
import { AppProviders } from "./app-providers";
import { MainLayout } from "@/components/layout/MainLayout";
import "./globals.css";

// [최적화] next/font로 Google Fonts 로드 - CLS 제거, 성능 개선
// 불필요한 폰트 제거로 초기 로딩 속도 개선 (약 200KB+ 감소)
const notoSerifKR = Noto_Serif_KR({
    weight: ['400', '700'],
    display: 'swap',
    subsets: ['latin'],
    variable: '--font-noto-serif',
    preload: true, // [PERF] 폰트 프리로드 명시
});

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
            { url: '/favicon.ico', sizes: 'any' },
        ],
        apple: '/favicon.ico',
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
    maximumScale: 1,
    userScalable: false,
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
            className={notoSerifKR.variable}
        >
            <head>
                {/* [PERF] 네트워크 최적화: 핵심 외부 도메인 Preconnect (TCP+TLS 핸드쉐이크 선행) */}
                {/* Supabase API - 데이터 페칭 핵심 */}
                {shouldPreconnectSupabase ? (
                    <link rel="preconnect" href={supabasePreconnectUrl} crossOrigin="anonymous" />
                ) : null}
                {/* 네이버 지도 - 메인 기능 */}
                <link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />
                <link rel="preconnect" href="https://openapi.map.naver.com" crossOrigin="anonymous" />
                <link rel="preconnect" href="https://ssl.pstatic.net" crossOrigin="anonymous" />
                {/* YouTube 썸네일 - LCP 개선 */}
                <link rel="preconnect" href="https://img.youtube.com" crossOrigin="anonymous" />
                {/* DNS Prefetch - 보조 도메인 (preconnect보다 가볍고 빠름) */}
                <link rel="dns-prefetch" href="https://nrbe.pstatic.net" />
                <link rel="dns-prefetch" href="https://i.ytimg.com" />
                <link rel="dns-prefetch" href="https://lh3.googleusercontent.com" />
            </head>
            <body className={notoSerifKR.className} suppressHydrationWarning>
                <Script src="/scripts/viewport-height-fix.js" strategy="beforeInteractive" />

                <QueryProvider>
                    <AppProviders>
                        <MainLayout>{children}</MainLayout>
                    </AppProviders>
                </QueryProvider>
                <SpeedInsights />
            </body>
        </html>
    );
}
