import { readFile, writeFile } from 'node:fs/promises';
import type { Catalog } from '../src/domain/types';
import { normalizeSearch } from '../src/domain/catalog';
import type { ReviewedWork } from './catalog-core';
import { validateCatalog } from '../src/services/validation';

const catalog = validateCatalog(JSON.parse(await readFile('src/data/catalog.json', 'utf8')));
const reviewed = JSON.parse(
  await readFile('scripts/reviewed-works.json', 'utf8'),
) as ReviewedWork[];
const mozart = catalog.composers.find((c) => c.aliases.includes('Mozart'))!;
const wanted = new Set(
  reviewed.filter((r) => r.composer === 'Mozart').map((r) => normalizeSearch(r.number)),
);
const selected = new Set(
  catalog.workIdentifiers
    .filter(
      (i) =>
        wanted.has(i.normalizedValue) &&
        catalog.works.some((w) => w.id === i.workId && w.composerId === mozart.id),
    )
    .map((i) => i.workId),
);
const extras = [
  'db5d41c9-6629-5a16-a341-00c8f8295558',
  '7709e903-b111-5b77-a797-4b0418b87c19',
  'd43490dc-aad8-5e00-a81d-74d0bd31cb2c',
  '04c00ce9-0645-5929-a123-788b023abf3b',
  'e22298f1-c7f3-5ab2-a49f-e532cfac597d',
  '8ef3d1ee-5f3c-5e32-ae2a-75b496d65b07',
];
for (const id of extras) {
  if (!catalog.works.some((w) => w.id === id)) throw new Error(`示例作品缺失：${id}`);
  selected.add(id);
}
if (selected.size !== 18) throw new Error('示例必须包含 12 部已核对的莫扎特作品和 6 部其他作品。');
const works = catalog.works
  .filter((w) => selected.has(w.id))
  .map((w) => ({ ...w, parentWorkId: undefined }));
const composerIds = new Set(works.map((w) => w.composerId));
const seed: Catalog = {
  composers: catalog.composers
    .filter((c) => composerIds.has(c.id))
    .map((c) => ({ ...c, coverageStatus: 'sample' })),
  works,
  workIdentifiers: catalog.workIdentifiers.filter((i) => selected.has(i.workId)),
  workAliases: catalog.workAliases.filter((a) => selected.has(a.workId)),
  sourceMappings: catalog.sourceMappings.filter((m) =>
    m.entityType === 'composer' ? composerIds.has(m.internalId) : selected.has(m.internalId),
  ),
};
await writeFile('src/data/seed.json', JSON.stringify(validateCatalog(seed), null, 2));
console.log(
  `已生成示例：${seed.composers.length} 位作曲家、${seed.works.length} 部作品，其中莫扎特 12 部。`,
);
