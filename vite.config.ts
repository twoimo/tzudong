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
    rollupOptions: {
      output: {
        manualChunks: {
          // React 관련 라이브러리 분리
          'react-vendor': ['react', 'react-dom'],
          // UI 라이브러리 분리
          'ui-vendor': ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-select'],
          // 데이터 페칭 라이브러리 분리
          'query-vendor': ['@tanstack/react-query', '@supabase/supabase-js'],
          // 유틸리티 라이브러리 분리
          'utils-vendor': ['clsx', 'tailwind-merge', 'class-variance-authority'],
        },
      },
    },
    // 청크 사이즈 경고 임계값 조정
    chunkSizeWarningLimit: 600,
  },
}));
