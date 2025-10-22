import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api/naver-geocode': {
        target: 'https://naveropenapi.apigw.ntruss.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/naver-geocode/, '/map-geocode/v2/geocode'),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            // 헤더 추가
            const apiKeyId = process.env.VITE_NAVER_CLIENT_ID;
            const apiKey = process.env.VITE_NAVER_CLIENT_SECRET;
            if (apiKeyId && apiKey) {
              proxyReq.setHeader('X-NCP-APIGW-API-KEY-ID', apiKeyId);
              proxyReq.setHeader('X-NCP-APIGW-API-KEY', apiKey);
            }
          });
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // 코드 스플리팅 최적화
    rollupOptions: {
      output: {
        manualChunks: {
          // React 관련 코드를 분리
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // UI 라이브러리 분리
          'ui-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip'
          ],
          // Supabase 분리
          'supabase-vendor': ['@supabase/supabase-js'],
          // React Query 분리
          'query-vendor': ['@tanstack/react-query'],
          // 아이콘 및 유틸리티
          'utils-vendor': ['lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority']
        }
      }
    },
    // 소스맵 비활성화 (프로덕션)
    sourcemap: mode === 'development',
    // 최소화 설정 (esbuild 사용 - 더 빠르고 안정적)
    minify: 'esbuild',
    // 청크 크기 제한
    chunkSizeWarningLimit: 1000
  },
  // 의존성 최적화
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@supabase/supabase-js',
      '@tanstack/react-query'
    ]
  }
}));
