import type { Metadata } from "next";
import { Noto_Serif_KR } from "next/font/google";
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
                <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL || ''} crossOrigin="anonymous" />
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
                {/* 초기 로딩 화면 - 순수 HTML, CSS로 제어 */}
                <div id="initial-loading-content">
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ position: 'relative', margin: '0 auto 1.5rem', width: '4rem', height: '4rem' }}>
                            <div style={{ position: 'absolute', inset: '0', borderRadius: '9999px', border: '4px solid', borderColor: 'hsl(var(--primary)/0.2)', borderTopColor: 'hsl(var(--primary))', animation: 'spin 1s linear infinite' }}></div>
                            <div style={{ position: 'absolute', inset: '0', borderRadius: '9999px', border: '4px solid transparent', borderRightColor: 'hsl(var(--secondary))', animation: 'spin 1.5s linear infinite' }}></div>
                        </div>
                        <div style={{ marginBottom: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', background: 'linear-gradient(to right,hsl(var(--primary)),hsl(var(--secondary)))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', marginBottom: '0.75rem' }}>쯔동여지도 로딩 중...</h2>
                            <p style={{ color: 'hsl(var(--muted-foreground))', marginBottom: '0.75rem' }}>맛있는 발견을 준비하고 있습니다</p>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.25rem' }}>
                                <div style={{ width: '0.5rem', height: '0.5rem', background: 'hsl(var(--primary))', borderRadius: '9999px', animation: 'bounce 1s infinite' }}></div>
                                <div style={{ width: '0.5rem', height: '0.5rem', background: 'hsl(var(--primary))', borderRadius: '9999px', animation: 'bounce 1s infinite', animationDelay: '0.1s' }}></div>
                                <div style={{ width: '0.5rem', height: '0.5rem', background: 'hsl(var(--primary))', borderRadius: '9999px', animation: 'bounce 1s infinite', animationDelay: '0.2s' }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* [PERF] 최소화된 인라인 스크립트 - 뷰포트 높이 계산 + 로딩 제거 */}
                <script dangerouslySetInnerHTML={{
                    __html: `(function(){var d=document.documentElement,s=d.style;function v(){if(CSS.supports('height','100dvh'))return;var h=window.innerHeight*.01;s.setProperty('--vh',h+'px');s.setProperty('--full-height',h*100+'px')}v();var t;window.addEventListener('resize',function(){clearTimeout(t);t=setTimeout(v,100)});window.addEventListener('orientationchange',function(){setTimeout(v,200)});var r=false;function hide(){if(r)return;r=true;document.body.classList.add('loading-complete')}window.addEventListener('mapLoadingComplete',hide,{once:true});setTimeout(hide,800)})();`
                }} />

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
