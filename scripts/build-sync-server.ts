import { build } from 'esbuild';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
await mkdir('dist-sync', { recursive: true });
await build({
  entryPoints: ['server/handler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-sync/index.js',
  external: ['pg-native'],
});
await writeFile(
  'dist-sync/package.json',
  JSON.stringify(
    { name: 'music-archive-sync', version: '1.0.0', private: true, main: 'index.js' },
    null,
    2,
  ),
);
await copyFile('server/migrations/001_sync.sql', 'dist-sync/001_sync.sql');
console.log('Cloud function built: dist-sync/index.js, handler index.main');
