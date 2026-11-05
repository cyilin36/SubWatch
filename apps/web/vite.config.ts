import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Only split heavy leaf dependencies. React, the router, query, i18n and
        // the rest stay in a single vendor chunk: splitting React from its
        // router dependencies creates a circular chunk graph, which crashes at
        // module init in production (TDZ ReferenceError) even though dev works.
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
          if (id.includes('/@codemirror/') || id.includes('/@uiw/') || id.includes('/codemirror/')) {
            return 'vendor-editor';
          }
          if (id.includes('/@radix-ui/')) return 'vendor-radix';
          if (id.includes('/lucide-react/')) return 'vendor-icons';
          return 'vendor';
        },
      },
    },
  },
});
