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
});

// 카카오톡 OG 이미지 표시를 위해 절대 URL 필요
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tzudong.vercel.app';

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: "쯔동여지도 - 쯔양 맛집 지도",
    description: "쯔양이 다녀간 맛집을 한눈에 확인하세요",
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: 'any' },
            { url: '/favicon.svg', type: 'image/svg+xml' },
        ],
        apple: '/favicon.ico',
    },
    openGraph: {
        title: '쯔동여지도 - 쯔양 맛집 지도',
        description: '쯔양이 다녀간 맛집을 한눈에 확인하세요',
        url: siteUrl,
        type: 'website',
        locale: 'ko_KR',
        siteName: '쯔동여지도',
        images: [
            {
                url: '/og-image-1.png',
                width: 1200,
                height: 630,
                alt: '쯔동여지도 - 쯔양 맛집 지도',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양 맛집 지도',
        description: '쯔양이 다녀간 맛집을 한눈에 확인하세요',
        images: ['/og-image-1.png'],
    },
};

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
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
                {/* Network Performance: Preconnect to external domains */}
                <link rel="preconnect" href="https://ssl.pstatic.net" crossOrigin="anonymous" />
                <link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />
                <link rel="dns-prefetch" href="https://nrbe.pstatic.net" />
                <link rel="dns-prefetch" href="https://kr-col-ext.nelo.navercorp.com" />
                {/* [OPTIMIZATION] YouTube 썸네일 도메인 - LCP 개선 */}
                <link rel="preconnect" href="https://img.youtube.com" crossOrigin="anonymous" />
                <link rel="dns-prefetch" href="https://i.ytimg.com" />
            </head>
            <body className={notoSerifKR.className}>
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

                <script dangerouslySetInnerHTML={{
                    __html: `
                        (function() {
                            var removed = false;
                            function hide() {
                                if (removed) return;
                                removed = true;
                                document.body.classList.add('loading-complete');
                            }
                            window.addEventListener('mapLoadingComplete', hide, { once: true });
                            setTimeout(hide, 1000);
                        })();
                    `
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
