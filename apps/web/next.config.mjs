import path from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'maps.googleapis.com',
            },
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
            },
        ],
    },
    env: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
        NEXT_PUBLIC_NAVER_CLIENT_ID: process.env.NEXT_PUBLIC_NAVER_CLIENT_ID,
        NEXT_PUBLIC_NAVER_CLIENT_SECRET: process.env.NEXT_PUBLIC_NAVER_CLIENT_SECRET,
    },
    output: 'standalone',
    outputFileTracingRoot: path.join(__dirname, '../../'),
    experimental: {
        forceSwcTransforms: false,
    },
    // Turbopack 설정 추가 (Next.js 16 호환성)
    turbopack: {},
    // Webpack 최적화 설정 추가
    webpack: (config, { dev, isServer }) => {
        if (!dev && !isServer) {
            // 프로덕션 클라이언트 빌드에서만 적용
            config.optimization = {
                ...config.optimization,
                splitChunks: {
                    chunks: 'all',
                    cacheGroups: {
                        default: false,
                        vendors: false,
                        // 큰 라이브러리 자동 분리 (160KB 이상)
                        lib: {
                            test(module) {
                                return module.size() > 160000;
                            },
                            name(module) {
                                const packageNameMatch = module.context?.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/);
                                const packageName = packageNameMatch ? packageNameMatch[1] : 'lib';
                                return `npm.${packageName.replace('@', '')}`;
                            },
                            priority: 20,
                            minChunks: 1,
                            reuseExistingChunk: true,
                        },
                        // 공통 모듈 분리
                        commons: {
                            name: 'commons',
                            minChunks: 2,
                            priority: 10,
                            reuseExistingChunk: true,
                        },
                    },
                },
            };
        }
        return config;
    },
};

export default withBundleAnalyzer(nextConfig);
