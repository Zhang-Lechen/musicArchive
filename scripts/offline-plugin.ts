import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

export function offlineShell(): Plugin {
  let outDir = '';
  return {
    name: 'archive-offline-shell',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await copyFile(path.resolve('src/data/catalog.json'), path.join(outDir, 'catalog.json'));
      const files: string[] = [];
      const hash = createHash('sha256');
      for (const name of (await readdir(outDir, { recursive: true })).sort()) {
        const full = path.join(outDir, name);
        if (!(await stat(full)).isFile() || name === 'sw.js') continue;
        files.push(`/${name.replaceAll('\\', '/')}`);
        hash.update(await readFile(full));
      }
      const cacheName = `cla-shell-${hash.digest('hex').slice(0, 16)}`;
      const code = `const CACHE = ${JSON.stringify(cacheName)};
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('activate', event => { event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith('cla-shell-') && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html')))); return; }
  if (FILES.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
});
`;
      await writeFile(path.join(outDir, 'sw.js'), code);
    },
  };
}
