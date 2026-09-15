import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { Noto_Serif_KR } from "next/font/google";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, OG_IMAGE_ALT, OG_IMAGE_PATH, SITE_NAME, SITE_URL } from "@/lib/seo";
import { resolveRootLayoutResourceHintPolicy } from "@/lib/root-layout-resource-hints";
import { VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE } from "@/lib/viewport-height-bootstrap";
import { RootSpeedInsights } from "./root-speed-insights";
import { LocalWorkspaceBanner } from "@/components/home/LocalWorkspaceBanner";
import "./globals.css";
export const dynamic = "force-dynamic";

// 카카오톡 OG 이미지 표시를 위해 절대 URL 필요
const siteUrl = SITE_URL;
const {
    emitHostedResourceHints,
    supabasePreconnectUrl,
} = resolveRootLayoutResourceHintPolicy({
    localRuntime: process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});
const pretendard = localFont({
    src: "./fonts/pretendard/PretendardVariable.woff2",
    variable: "--font-pretendard",
    display: "swap",
    preload: false,
    weight: "45 920",
});

const notoSerifKr = Noto_Serif_KR({
    subsets: ["latin"],
    variable: "--font-display",
    display: "swap",
});
export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: [
        '쯔양 맛집',
        '쯔동여지도',
        '쯔양 맛집 지도',
        '유튜브 맛집 지도',
        '먹방 맛집',
        '서울 맛집',
        '전국 맛집',
        '도장 깨기',
        'Tzuyang restaurant map',
    ],
    manifest: '/manifest.webmanifest',
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
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#09090b' },
    ],
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const nonce = (await headers()).get("x-nonce") ?? undefined;

    return (
        <html
            lang="ko"
            className={`${pretendard.variable} ${notoSerifKr.variable} ${pretendard.className}`}
            data-local-workspace={process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === "1" ? "true" : undefined}
            suppressHydrationWarning
        >
            <head>
                {/* [GEO / AEO] Geographic & AI Engine Discovery Meta Tags */}
                <meta name="geo.region" content="KR" />
                <meta name="geo.placename" content="대한민국" />
                <meta name="geo.position" content="37.5665;126.9780" />
                <meta name="ICBM" content="37.5665, 126.9780" />
                <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM Content Summary" />
                <link rel="alternate" type="text/plain" href="/llms-full.txt" title="LLM Full Dataset Context" />
                <script
                    nonce={nonce}
                    suppressHydrationWarning
                    dangerouslySetInnerHTML={{ __html: VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE }}
                />
                {/* [PERF] 네트워크 최적화: 초기 렌더에 필요한 도메인만 Preconnect (TCP+TLS 핸드쉐이크 선행) */}
                {/* Supabase API - 데이터 페칭 핵심 */}
                {supabasePreconnectUrl ? (
                    <link rel="preconnect" href={supabasePreconnectUrl} crossOrigin="anonymous" />
                ) : null}
                {emitHostedResourceHints ? (
                    <>
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
                    </>
                ) : null}
            </head>
            <body suppressHydrationWarning>
                <LocalWorkspaceBanner />
                <div data-local-workspace-app="true">
                    {children}
                </div>
                <RootSpeedInsights />
            </body>
        </html>
    );
}
