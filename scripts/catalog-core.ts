import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalSystem, catalogSortKey, normalizeSearch } from '../src/domain/catalog';
import type { Catalog, Source } from '../src/domain/types';
import { validateCatalog } from '../src/services/validation';

export const rawWorkSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  subtitle: z.string().default(''),
  searchterms: z.union([z.string(), z.array(z.string())]).default(''),
  genre: z.string().default(''),
});
export const rawComposerSchema = z.object({
  id: z.string(),
  name: z.string(),
  complete_name: z.string(),
  birth: z.string().nullable(),
  death: z.string().nullable(),
  epoch: z.string(),
  works: z.array(rawWorkSchema),
});
export const snapshotSchema = z.object({
  retrievedAt: z.string().datetime(),
  license: z.literal('CC0-1.0'),
  composers: z.array(rawComposerSchema),
});
export type RawComposer = z.infer<typeof rawComposerSchema>;
export type Review = { sourceId: string; composer: string; title: string; reason: string };
export const composerLabels: Record<
  string,
  { nameZh: string; catalog?: string; aliases: string[] }
> = {
  Mozart: { nameZh: '莫扎特', catalog: 'K.', aliases: ['莫札特', 'Mozart'] },
  Beethoven: { nameZh: '贝多芬', catalog: 'Op. / WoO / Hess', aliases: ['Beethoven'] },
  Bach: { nameZh: '巴赫', catalog: 'BWV', aliases: ['巴哈', 'Bach'] },
  Haydn: { nameZh: '海顿', catalog: 'Hob.', aliases: ['Haydn'] },
  Schubert: { nameZh: '舒伯特', catalog: 'D.', aliases: ['Schubert'] },
  Vivaldi: { nameZh: '维瓦尔第', catalog: 'RV', aliases: ['韦瓦第', 'Vivaldi'] },
  Chopin: { nameZh: '肖邦', catalog: 'Op.', aliases: ['萧邦', 'Chopin'] },
  Tchaikovsky: { nameZh: '柴可夫斯基', catalog: 'Op.', aliases: ['Tchaikovsky'] },
  Brahms: { nameZh: '勃拉姆斯', catalog: 'Op.', aliases: ['布拉姆斯', 'Brahms'] },
  Debussy: { nameZh: '德彪西', catalog: 'L.', aliases: ['Debussy'] },
  Ravel: { nameZh: '拉威尔', aliases: ['Ravel'] },
  Schumann: { nameZh: '舒曼', catalog: 'Op.', aliases: ['Schumann'] },
  Liszt: { nameZh: '李斯特', catalog: 'S.', aliases: ['Liszt'] },
  Handel: { nameZh: '亨德尔', catalog: 'HWV', aliases: ['Händel', 'Handel'] },
};
export function stableId(type: string, externalId: string) {
  const hash = createHash('sha256')
    .update(`classical-archive:openopus:${type}:${externalId}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function extractIdentifiers(title: string) {
  const pattern =
    /\b(KV?|BWV|Op|WoO|Hess|Hob|D|RV|HWV|WAB|FP|Wq|Sz|BB|S|L)\.?\s*((?:Anh\.?\s*)?(?:[IVXLC]+[a-z]?:\s*)?\d+[a-z]?(?:\s*(?:,?\s*(?:no|nr)\.?\s*|[/:])\d+[a-z]?)?(?:-\d+[a-z]?)?)/gi;
  return [...title.matchAll(pattern)].map((match) => ({
    system: canonicalSystem(match[1]!),
    value: `${canonicalSystem(match[1]!)}. ${match[2]!.trim()}`,
  }));
}

export type ReviewedWork = {
  composer: string;
  number: string;
  titleZh: string;
  aliases?: string[];
  status?: 'confirmed' | 'fragment' | 'doubtful' | 'lost';
  reference: string;
};

export function normalizeSnapshot(input: unknown, reviewed: ReviewedWork[] = []) {
  const snapshot = snapshotSchema.parse(input);
  const catalog: Catalog = {
    composers: [],
    works: [],
    workIdentifiers: [],
    workAliases: [],
    sourceMappings: [],
  };
  const reviews: Review[] = [];
  const ids = new Set<string>();
  const numbers = new Map<string, string>();
  const names = new Map<string, string>();
  for (const composer of snapshot.composers) {
    const composerId = stableId('composer', composer.id);
    const label = composerLabels[composer.name];
    const source: Source = {
      name: 'Open Opus',
      url: `https://api.openopus.org/work/list/composer/${encodeURIComponent(composer.id)}/genre/all.json`,
      license: 'CC0-1.0',
      retrievedAt: snapshot.retrievedAt,
      catalogEdition: '来源未注明版次',
    };
    catalog.composers.push({
      id: composerId,
      nameOriginal: composer.complete_name,
      nameZh: label?.nameZh,
      aliases: label?.aliases ?? [composer.name],
      birthYear: composer.birth ? Number(composer.birth.slice(0, 4)) : undefined,
      deathYear: composer.death ? Number(composer.death.slice(0, 4)) : undefined,
      era: composer.epoch,
      primaryCatalog: label?.catalog,
      coverageStatus: 'partial',
      source,
    });
    catalog.sourceMappings.push({
      id: stableId('mapping-composer', composer.id),
      entityType: 'composer',
      internalId: composerId,
      sourceName: 'Open Opus',
      sourceId: composer.id,
      lastSeenAt: snapshot.retrievedAt,
    });
    for (const work of composer.works) {
      if (ids.has(work.id)) {
        reviews.push({
          sourceId: work.id,
          composer: composer.name,
          title: work.title,
          reason: '重复来源 ID，保留第一条',
        });
        continue;
      }
      ids.add(work.id);
      const workId = stableId('work', work.id);
      const identifiers = extractIdentifiers(work.title);
      const checked = reviewed.find(
        (item) =>
          item.composer === composer.name &&
          identifiers.some((i) => normalizeSearch(i.value) === normalizeSearch(item.number)),
      );
      const titleKey = `${composerId}:${normalizeSearch(work.title)}`;
      if (names.has(titleKey))
        reviews.push({
          sourceId: work.id,
          composer: composer.name,
          title: work.title,
          reason: `作品名称冲突，与 ${names.get(titleKey)} 人工复核`,
        });
      names.set(titleKey, work.id);
      catalog.works.push({
        id: workId,
        composerId,
        titleOriginal: work.title,
        titleZh: checked?.titleZh,
        genre: work.genre || undefined,
        kind: 'work',
        catalogStatus: checked?.status ?? 'confirmed',
      });
      if (!identifiers.length)
        reviews.push({
          sourceId: work.id,
          composer: composer.name,
          title: work.title,
          reason: '缺少可识别编号，界面明确显示未编号，不猜测补号',
        });
      if (/-\d|\bAnh|\//i.test(identifiers.map((i) => i.value).join(' ')))
        reviews.push({
          sourceId: work.id,
          composer: composer.name,
          title: work.title,
          reason: '补遗、范围或修订编号需核对版本与层级',
        });
      for (const [index, item] of identifiers.entries()) {
        const key = `${composerId}:${item.system}:${normalizeSearch(item.value)}`;
        if (numbers.has(key) && numbers.get(key) !== work.id)
          reviews.push({
            sourceId: work.id,
            composer: composer.name,
            title: work.title,
            reason: `编号冲突，与 ${numbers.get(key)} 人工复核；保留独立实体`,
          });
        numbers.set(key, work.id);
        catalog.workIdentifiers.push({
          ...item,
          id: stableId('identifier', `${work.id}:${index}`),
          workId,
          normalizedValue: normalizeSearch(item.value),
          sortKey: catalogSortKey(item.system, item.value),
          isPrimary: index === 0,
        });
      }
      const aliases = new Set([
        work.subtitle,
        ...(typeof work.searchterms === 'string' ? [work.searchterms] : work.searchterms),
        ...[...work.title.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
        ...(checked?.aliases ?? []),
      ]);
      for (const [index, text] of [...aliases].filter((t) => t.trim()).entries())
        catalog.workAliases.push({
          id: stableId('alias', `${work.id}:${index}`),
          workId,
          text,
          kind: checked?.aliases?.includes(text) ? 'reviewed' : 'source',
        });
      catalog.sourceMappings.push({
        id: stableId('mapping-work', work.id),
        entityType: 'work',
        internalId: workId,
        sourceName: 'Open Opus',
        sourceId: work.id,
        lastSeenAt: snapshot.retrievedAt,
      });
    }
  }
  return { catalog: validateCatalog(catalog), reviews };
}
