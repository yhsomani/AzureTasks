import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/presentation/web/public',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: path.resolve(process.cwd(), 'src/presentation/web/src/main.tsx'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src/presentation/web/src'),
    },
  },
});
