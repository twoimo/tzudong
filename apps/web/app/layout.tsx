import type { Metadata } from "next";
import { Noto_Serif_KR } from "next/font/google";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, OG_IMAGE_ALT, OG_IMAGE_PATH, SITE_NAME, SITE_URL } from "@/lib/seo";
import { RootSpeedInsights } from "./root-speed-insights";
import "./globals.css";

// 카카오톡 OG 이미지 표시를 위해 절대 URL 필요
const siteUrl = SITE_URL;
const supabasePreconnectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const shouldPreconnectSupabase = Boolean(supabasePreconnectUrl && /^https?:\/\//i.test(supabasePreconnectUrl));
const notoSerifKr = Noto_Serif_KR({
    weight: ['400', '700'],
    preload: false,
    display: 'swap',
    variable: '--font-noto-serif-kr',
    fallback: ['Apple SD Gothic Neo', 'Malgun Gothic', 'ui-serif', 'Georgia', 'serif'],
});
export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    applicationName: SITE_NAME,
    alternates: {
        canonical: '/',
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
        },
    },
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
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        url: siteUrl,
        type: 'website',
        locale: 'ko_KR',
        siteName: SITE_NAME,
        images: [
            {
                url: OG_IMAGE_PATH,
                width: 1200,
                height: 630,
                alt: OG_IMAGE_ALT,
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        images: [OG_IMAGE_PATH],
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
            className={notoSerifKr.variable}
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
