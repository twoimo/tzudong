import type { Metadata } from "next";
import { QueryProvider } from "./providers";
import { AppProviders } from "./app-providers";
import { MainLayout } from "@/components/layout/MainLayout";
import "./globals.css";

export const metadata: Metadata = {
    title: "쯔동여지도여지도 - 쯔양 맛집 지도",
    description: "쯔양이 다녀간 맛집을 한눈에 확인하세요",
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: 'any' },
            { url: '/favicon.svg', type: 'image/svg+xml' },
        ],
        apple: '/favicon.ico',
    },
};

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
};

// Google Fonts Preload
const googleFontsLink = (
    <>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
            href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Stylish&family=Gugi&family=Nanum+Brush+Script&family=Yeon+Sung&family=Noto+Serif+KR:wght@400;700&display=swap"
            rel="stylesheet"
        />
    </>
);

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ko" suppressHydrationWarning>
            <head>
                {googleFontsLink}
            </head>
            <body className="font-serif">
                <QueryProvider>
                    <AppProviders>
                        <MainLayout>{children}</MainLayout>
                    </AppProviders>
                </QueryProvider>
            </body>
        </html>
    );
}
