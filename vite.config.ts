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
}));
