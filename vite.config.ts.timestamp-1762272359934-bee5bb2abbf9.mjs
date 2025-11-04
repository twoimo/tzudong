// vite.config.ts
import { defineConfig } from "file:///C:/Users/twoimo/Desktop/tzudong/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/twoimo/Desktop/tzudong/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///C:/Users/twoimo/Desktop/tzudong/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "C:\\Users\\twoimo\\Desktop\\tzudong";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api/naver-geocode": {
        target: "https://naveropenapi.apigw.ntruss.com",
        changeOrigin: true,
        rewrite: (path2) => path2.replace(/^\/api\/naver-geocode/, "/map-geocode/v2/geocode"),
        configure: (proxy, options) => {
          proxy.on("proxyReq", (proxyReq, req, res) => {
            const apiKeyId = process.env.VITE_NAVER_CLIENT_ID;
            const apiKey = process.env.VITE_NAVER_CLIENT_SECRET;
            if (apiKeyId && apiKey) {
              proxyReq.setHeader("X-NCP-APIGW-API-KEY-ID", apiKeyId);
              proxyReq.setHeader("X-NCP-APIGW-API-KEY", apiKey);
            }
          });
        }
      }
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React 관련 라이브러리 분리
          "react-vendor": ["react", "react-dom"],
          // UI 라이브러리 분리
          "ui-vendor": ["lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-select"],
          // 데이터 페칭 라이브러리 분리
          "query-vendor": ["@tanstack/react-query", "@supabase/supabase-js"],
          // 유틸리티 라이브러리 분리
          "utils-vendor": ["clsx", "tailwind-merge", "class-variance-authority"]
        }
      }
    },
    // 청크 사이즈 경고 임계값 조정
    chunkSizeWarningLimit: 600
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx0d29pbW9cXFxcRGVza3RvcFxcXFx0enVkb25nXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFx0d29pbW9cXFxcRGVza3RvcFxcXFx0enVkb25nXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy90d29pbW8vRGVza3RvcC90enVkb25nL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcclxuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcclxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHsgY29tcG9uZW50VGFnZ2VyIH0gZnJvbSBcImxvdmFibGUtdGFnZ2VyXCI7XHJcblxyXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiAoe1xyXG4gIHNlcnZlcjoge1xyXG4gICAgaG9zdDogXCI6OlwiLFxyXG4gICAgcG9ydDogODA4MCxcclxuICAgIHByb3h5OiB7XHJcbiAgICAgICcvYXBpL25hdmVyLWdlb2NvZGUnOiB7XHJcbiAgICAgICAgdGFyZ2V0OiAnaHR0cHM6Ly9uYXZlcm9wZW5hcGkuYXBpZ3cubnRydXNzLmNvbScsXHJcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC9hcGlcXC9uYXZlci1nZW9jb2RlLywgJy9tYXAtZ2VvY29kZS92Mi9nZW9jb2RlJyksXHJcbiAgICAgICAgY29uZmlndXJlOiAocHJveHksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgIHByb3h5Lm9uKCdwcm94eVJlcScsIChwcm94eVJlcSwgcmVxLCByZXMpID0+IHtcclxuICAgICAgICAgICAgLy8gXHVENUU0XHVCMzU0IFx1Q0Q5NFx1QUMwMFxyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXlJZCA9IHByb2Nlc3MuZW52LlZJVEVfTkFWRVJfQ0xJRU5UX0lEO1xyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXkgPSBwcm9jZXNzLmVudi5WSVRFX05BVkVSX0NMSUVOVF9TRUNSRVQ7XHJcbiAgICAgICAgICAgIGlmIChhcGlLZXlJZCAmJiBhcGlLZXkpIHtcclxuICAgICAgICAgICAgICBwcm94eVJlcS5zZXRIZWFkZXIoJ1gtTkNQLUFQSUdXLUFQSS1LRVktSUQnLCBhcGlLZXlJZCk7XHJcbiAgICAgICAgICAgICAgcHJveHlSZXEuc2V0SGVhZGVyKCdYLU5DUC1BUElHVy1BUEktS0VZJywgYXBpS2V5KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfSxcclxuICBwbHVnaW5zOiBbcmVhY3QoKSwgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpXS5maWx0ZXIoQm9vbGVhbiksXHJcbiAgcmVzb2x2ZToge1xyXG4gICAgYWxpYXM6IHtcclxuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgYnVpbGQ6IHtcclxuICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICAvLyBSZWFjdCBcdUFEMDBcdUI4MjggXHVCNzdDXHVDNzc0XHVCRTBDXHVCN0VDXHVCOUFDIFx1QkQ4NFx1QjlBQ1xyXG4gICAgICAgICAgJ3JlYWN0LXZlbmRvcic6IFsncmVhY3QnLCAncmVhY3QtZG9tJ10sXHJcbiAgICAgICAgICAvLyBVSSBcdUI3N0NcdUM3NzRcdUJFMENcdUI3RUNcdUI5QUMgXHVCRDg0XHVCOUFDXHJcbiAgICAgICAgICAndWktdmVuZG9yJzogWydsdWNpZGUtcmVhY3QnLCAnQHJhZGl4LXVpL3JlYWN0LWRpYWxvZycsICdAcmFkaXgtdWkvcmVhY3Qtc2VsZWN0J10sXHJcbiAgICAgICAgICAvLyBcdUIzNzBcdUM3NzRcdUQxMzAgXHVEMzk4XHVDRTZEIFx1Qjc3Q1x1Qzc3NFx1QkUwQ1x1QjdFQ1x1QjlBQyBcdUJEODRcdUI5QUNcclxuICAgICAgICAgICdxdWVyeS12ZW5kb3InOiBbJ0B0YW5zdGFjay9yZWFjdC1xdWVyeScsICdAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXSxcclxuICAgICAgICAgIC8vIFx1QzcyMFx1RDJGOFx1QjlBQ1x1RDJGMCBcdUI3N0NcdUM3NzRcdUJFMENcdUI3RUNcdUI5QUMgXHVCRDg0XHVCOUFDXHJcbiAgICAgICAgICAndXRpbHMtdmVuZG9yJzogWydjbHN4JywgJ3RhaWx3aW5kLW1lcmdlJywgJ2NsYXNzLXZhcmlhbmNlLWF1dGhvcml0eSddLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgLy8gXHVDQ0FEXHVEMDZDIFx1QzBBQ1x1Qzc3NFx1Qzk4OCBcdUFDQkRcdUFDRTAgXHVDNzg0XHVBQ0M0XHVBQzEyIFx1Qzg3MFx1QzgxNVxyXG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiA2MDAsXHJcbiAgfSxcclxufSkpO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlSLFNBQVMsb0JBQW9CO0FBQ3RULE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFDakIsU0FBUyx1QkFBdUI7QUFIaEMsSUFBTSxtQ0FBbUM7QUFNekMsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE9BQU87QUFBQSxFQUN6QyxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxzQkFBc0I7QUFBQSxRQUNwQixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxTQUFTLENBQUNBLFVBQVNBLE1BQUssUUFBUSx5QkFBeUIseUJBQXlCO0FBQUEsUUFDbEYsV0FBVyxDQUFDLE9BQU8sWUFBWTtBQUM3QixnQkFBTSxHQUFHLFlBQVksQ0FBQyxVQUFVLEtBQUssUUFBUTtBQUUzQyxrQkFBTSxXQUFXLFFBQVEsSUFBSTtBQUM3QixrQkFBTSxTQUFTLFFBQVEsSUFBSTtBQUMzQixnQkFBSSxZQUFZLFFBQVE7QUFDdEIsdUJBQVMsVUFBVSwwQkFBMEIsUUFBUTtBQUNyRCx1QkFBUyxVQUFVLHVCQUF1QixNQUFNO0FBQUEsWUFDbEQ7QUFBQSxVQUNGLENBQUM7QUFBQSxRQUNIO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTLENBQUMsTUFBTSxHQUFHLFNBQVMsaUJBQWlCLGdCQUFnQixDQUFDLEVBQUUsT0FBTyxPQUFPO0FBQUEsRUFDOUUsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0wsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBO0FBQUEsVUFFWixnQkFBZ0IsQ0FBQyxTQUFTLFdBQVc7QUFBQTtBQUFBLFVBRXJDLGFBQWEsQ0FBQyxnQkFBZ0IsMEJBQTBCLHdCQUF3QjtBQUFBO0FBQUEsVUFFaEYsZ0JBQWdCLENBQUMseUJBQXlCLHVCQUF1QjtBQUFBO0FBQUEsVUFFakUsZ0JBQWdCLENBQUMsUUFBUSxrQkFBa0IsMEJBQTBCO0FBQUEsUUFDdkU7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSx1QkFBdUI7QUFBQSxFQUN6QjtBQUNGLEVBQUU7IiwKICAibmFtZXMiOiBbInBhdGgiXQp9Cg==
