/// <reference types="vitest" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/';

  return {
    base,
    server: {
      port: 3320,
      host: '0.0.0.0',
      proxy: {
        [base === '/' ? '/api' : `${base.replace(/\/$/, '')}/api`]: {
          target: 'http://localhost:3325',
          changeOrigin: true,
          timeout: 600_000,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        'virtual:pwa-register': path.resolve(__dirname, 'src/virtual-pwa-register.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // 重依赖分包：charts 仅仪表盘用、markdown 全家桶仅 AI 侧栏用，
          // 拆离后首屏（登录页等）不再下载这些体积，且升级时缓存命中率更高
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-charts': ['recharts'],
            'vendor-markdown': [
              'react-markdown',
              'remark-gfm',
              'remark-math',
              'rehype-katex',
              'rehype-highlight',
              'katex',
            ],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
    },
  };
});
