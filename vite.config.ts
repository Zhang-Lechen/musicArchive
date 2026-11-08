import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { offlineShell } from './scripts/offline-plugin.ts';

export default defineConfig({
  plugins: [react(), offlineShell()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](?:react(?:-dom)?|scheduler)[\\/]/ },
            { name: 'storage', test: /[\\/]node_modules[\\/](?:dexie|dexie-react-hooks|zod)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    clearMocks: true,
  },
});
