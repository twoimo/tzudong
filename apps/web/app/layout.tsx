import type { Metadata } from "next";
import { Noto_Serif_KR } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { QueryProvider } from "./providers";
import { AppProviders } from "./app-providers";
import { MainLayout } from "@/components/layout/MainLayout";
import "./globals.css";
import Script from 'next/script';

// [최적화] 네이버 지도 리소스 연결 최적화
const PreconnectLinks = () => (
    <>
        <link rel="preconnect" href="https://openapi.map.naver.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://openapi.map.naver.com" />
        <link rel="dns-prefetch" href="https://oapi.map.naver.com" />
    </>
);

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
    title: "쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에! 전국 맛집 지도 플랫폼",
    description: "쯔양 유튜브에 나온 전국 맛집을 지도에서 한눈에! 영상 보기, 리뷰, 도장 깨기까지",
    icons: {
        icon: [
            { url: '/favicon.svg', type: 'image/svg+xml' },
        ],
        apple: '/favicon.svg',
    },
    openGraph: {
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에! 전국 맛집 지도 플랫폼',
        description: '쯔양 유튜브에 나온 전국 맛집을 지도에서 한눈에! 영상 보기, 리뷰, 도장 깨기까지',
        url: siteUrl,
        type: 'website',
        locale: 'ko_KR',
        siteName: '쯔동여지도',
        images: [
            {
                url: '/og-image-1.png',
                width: 1200,
                height: 630,
                alt: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에! 전국 맛집 지도 플랫폼',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에! 전국 맛집 지도 플랫폼',
        description: '쯔양 유튜브에 나온 전국 맛집을 지도에서 한눈에! 영상 보기, 리뷰, 도장 깨기까지',
        images: ['/og-image-1.png'],
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
                {/* Network Performance: Preconnect to external domains */}
                <link rel="preconnect" href="https://ssl.pstatic.net" crossOrigin="anonymous" />
                <link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />
                <link rel="preconnect" href="https://openapi.map.naver.com" crossOrigin="anonymous" />
                <link rel="dns-prefetch" href="https://nrbe.pstatic.net" />
                <link rel="dns-prefetch" href="https://kr-col-ext.nelo.navercorp.com" />
                <link rel="dns-prefetch" href="https://openapi.map.naver.com" />
                {/* [OPTIMIZATION] YouTube 썸네일 도메인 - LCP 개선 */}
                <link rel="preconnect" href="https://img.youtube.com" crossOrigin="anonymous" />
                <link rel="dns-prefetch" href="https://i.ytimg.com" />
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

                <script dangerouslySetInnerHTML={{
                    __html: `
                        (function() {
                            // ==========================================
                            // 모바일 뷰포트 높이 동적 계산 (JS Fallback)
                            // dvh/svh 미지원 구형 브라우저용
                            // ==========================================
                            function setViewportHeight() {
                                // [OPTIMIZATION] 100dvh 지원 시 강제 리플로우(offsetHeight 참조) 방지
                                if (CSS.supports('height', '100dvh')) {
                                    // dvh 지원 브라우저는 CSS에서 처리하므로 계산 건너뜀
                                    // 단, --vh 변수가 필요한 다른 로직이 있다면 계산해야 함.
                                    // 현재 코드베이스에서는 --full-height가 핵심이므로, --full-height만 100dvh로 설정해주면 됨.
                                    // 하지만 JS 변수 의존성을 완전히 제거하기 위해 fallback만 남겨둠.
                                    // 여기서는 초기 로딩 성능(32ms 리플로우) 절약을 위해 아무것도 하지 않음.
                                    return;
                                }

                                // 1vh = window.innerHeight의 1%
                                // 모바일 브라우저의 동적 UI(URL 바, 하단 네비)를 제외한 실제 가시 높이
                                var vh = window.innerHeight * 0.01;
                                document.documentElement.style.setProperty('--vh', vh + 'px');
                                document.documentElement.style.setProperty('--full-height', (vh * 100) + 'px');
                            }
                            
                            // 초기 설정
                            setViewportHeight();
                            
                            // resize/orientationchange 이벤트에 debounce 적용
                            var resizeTimeout;
                            function onResize() {
                                clearTimeout(resizeTimeout);
                                resizeTimeout = setTimeout(setViewportHeight, 100);
                            }
                            
                            window.addEventListener('resize', onResize);
                            window.addEventListener('orientationchange', function() {
                                // orientationchange 후 약간의 지연 필요 (브라우저 UI 재배치)
                                setTimeout(setViewportHeight, 200);
                            });
                            
                            // ==========================================
                            // 초기 로딩 화면 제거
                            // ==========================================
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
