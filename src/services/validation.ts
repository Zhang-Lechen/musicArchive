import { z } from 'zod';
import { catalogSortKey, normalizeSearch } from '../domain/catalog';
import { listeningDateKey, validateDate } from '../domain/dates';
import { normalizeWork, type Backup, type Catalog } from '../domain/types';

const id = z.string().min(1).max(200);
const text = z.string().min(1).max(2000);
const timestamp = z.string().datetime({ offset: true });
const source = z
  .object({
    name: text,
    url: z
      .string()
      .url()
      .regex(/^https?:\/\//),
    license: text,
    retrievedAt: timestamp,
    catalogEdition: text.optional(),
  })
  .strict();
export const composerSchema = z
  .object({
    id,
    nameOriginal: text,
    nameZh: text.optional(),
    aliases: z.array(text).max(100).default([]),
    birthYear: z.number().int().min(-3000).max(9999).optional(),
    deathYear: z.number().int().min(-3000).max(9999).optional(),
    era: text.optional(),
    primaryCatalog: text.optional(),
    coverageStatus: z.enum(['sample', 'partial', 'verified']),
    source: source.optional(),
  })
  .strict();
export const workSchema = z
  .object({
    id,
    composerId: id,
    titleOriginal: text,
    titleZh: text.optional(),
    genre: text.optional(),
    key: text.optional(),
    parentWorkId: id.optional(),
    kind: z.enum(['work', 'collection', 'movement']).default('work'),
    nodeType: z.enum(['standalone', 'collection', 'movement', 'excerpt', 'part']).optional(),
    countPolicy: z.enum(['countable', 'container', 'noncountable']).optional(),
    isPerformable: z.boolean().optional(),
    primaryGenre: text.optional(),
    catalogStatus: z.enum(['confirmed', 'doubtful', 'lost', 'fragment']),
    source: source.optional(),
    userCreated: z.boolean().optional(),
  })
  .strict()
  .transform(normalizeWork);
const identifier = z
  .object({
    id,
    workId: id,
    system: text,
    value: text,
    normalizedValue: text,
    sortKey: text,
    isPrimary: z.boolean(),
    edition: text.optional(),
    source: source.optional(),
  })
  .strict();
const alias = z
  .object({ id, workId: id, text, locale: text.optional(), kind: text.optional() })
  .strict();
const mapping = z
  .object({
    id,
    entityType: z.enum(['composer', 'work']),
    internalId: id,
    sourceName: text,
    sourceId: text,
    lastSeenAt: timestamp,
  })
  .strict();
const catalogFields = {
  composers: z.array(composerSchema).max(20000),
  works: z.array(workSchema).max(200000),
  workIdentifiers: z.array(identifier).max(500000),
  workAliases: z.array(alias).max(500000),
  sourceMappings: z.array(mapping).max(500000).default([]),
};
export const catalogSchema = z.object(catalogFields).strict();
export const composerPreferenceSchema = z
  .object({
    composerId: id,
    isFollowing: z.boolean(),
    isFavorite: z.boolean(),
    updatedAt: timestamp,
  })
  .strict();
export const workPreferenceSchema = z
  .object({
    workId: id,
    isFavorite: z.boolean(),
    isInQueue: z.boolean(),
    updatedAt: timestamp,
  })
  .strict();
export const publicLabelSchema = z
  .object({
    id,
    workId: id,
    labelType: z.enum(['popular', 'source_recommended', 'representative']),
    sourceName: text,
    sourceId: text.optional(),
    sourceUrl: z
      .string()
      .url()
      .regex(/^https?:\/\//)
      .optional(),
    sourceDate: text.optional(),
    reviewStatus: z.enum(['source_provided', 'pending', 'reviewed']),
    methodVersion: text.optional(),
  })
  .strict();
export const backupSchema = z
  .object({
    ...catalogFields,
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    exportedAt: timestamp,
    workProgress: z
      .array(
        z
          .object({
            workId: id,
            isHeard: z.boolean(),
            updatedAt: timestamp,
            status: z.enum(['unheard', 'partial', 'completed']).optional(),
          })
          .strict()
          .transform((row) => ({
            ...row,
            status: row.status ?? (row.isHeard ? ('completed' as const) : ('unheard' as const)),
          })),
      )
      .max(200000),
    listeningRecords: z
      .array(
        z
          .object({
            id,
            workId: id,
            datePrecision: z.enum(['day', 'month', 'year', 'unknown']),
            dateValue: z.string().max(10).nullable(),
            dateKey: text.optional(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict()
          .transform((record) => ({
            ...record,
            dateKey: record.dateKey ?? listeningDateKey(record.datePrecision, record.dateValue),
          })),
      )
      .max(500000),
    appMetadata: z
      .array(z.object({ key: id, value: z.json() }).strict())
      .max(1000)
      .default([]),
    composerPreferences: z.array(composerPreferenceSchema).max(20000).default([]),
    workPreferences: z.array(workPreferenceSchema).max(200000).default([]),
    workPublicLabels: z.array(publicLabelSchema).max(500000).default([]),
  })
  .strict()
  .transform((backup) => ({ ...backup, formatVersion: 2 as const }));

function unique<T>(items: T[], key: (item: T) => string, label: string) {
  const ids = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (ids.has(value)) throw new Error(`${label} 有重复键：${value}`);
    ids.add(value);
  }
}
export function validateCatalog(value: unknown): Catalog {
  const catalog = catalogSchema.parse(value);
  unique(catalog.composers, (c) => c.id, '作曲家');
  unique(catalog.works, (w) => w.id, '作品');
  unique(catalog.workIdentifiers, (i) => i.id, '编号');
  unique(catalog.workAliases, (a) => a.id, '别名');
  unique(catalog.sourceMappings, (m) => m.id, '来源映射');
  unique(
    catalog.sourceMappings,
    (m) => JSON.stringify([m.sourceName, m.entityType, m.sourceId]),
    '外部来源',
  );
  const composers = new Set(catalog.composers.map((c) => c.id));
  const works = new Map(catalog.works.map((w) => [w.id, w]));
  for (const item of catalog.works) {
    if (!composers.has(item.composerId)) throw new Error('作品引用了不存在的作曲家。');
    if (item.nodeType === 'movement' && !item.parentWorkId)
      throw new Error('乐章必须关联上级作品。');
    let current = item;
    const seen = new Set([item.id]);
    while (current.parentWorkId) {
      const parent = works.get(current.parentWorkId);
      if (!parent || parent.composerId !== item.composerId) throw new Error('作品层级引用无效。');
      if (seen.has(parent.id)) throw new Error('作品层级存在循环。');
      seen.add(parent.id);
      current = parent;
    }
  }
  const primary = new Map<string, number>();
  for (const item of catalog.workIdentifiers) {
    if (!works.has(item.workId)) throw new Error('编号引用了不存在的作品。');
    if (
      item.normalizedValue !== normalizeSearch(item.value) ||
      item.sortKey !== catalogSortKey(item.system, item.value, item.edition)
    )
      throw new Error('编号规范化值或排序键与显示编号不一致。');
    if (item.isPrimary) primary.set(item.workId, (primary.get(item.workId) ?? 0) + 1);
  }
  for (const workId of new Set(catalog.workIdentifiers.map((i) => i.workId))) {
    if (primary.get(workId) !== 1) throw new Error('有编号作品必须且只能有一个主编号。');
  }
  for (const item of catalog.workAliases)
    if (!works.has(item.workId)) throw new Error('别名引用了不存在的作品。');
  for (const item of catalog.sourceMappings)
    if (
      !(item.entityType === 'composer'
        ? composers.has(item.internalId)
        : works.has(item.internalId))
    )
      throw new Error('来源映射引用无效。');
  return catalog;
}

export function validateBackup(value: unknown): { backup: Backup; mergedRecords: number } {
  const parsed = backupSchema.parse(value);
  validateCatalog({
    composers: parsed.composers,
    works: parsed.works,
    workIdentifiers: parsed.workIdentifiers,
    workAliases: parsed.workAliases,
    sourceMappings: parsed.sourceMappings,
  });
  unique(parsed.workProgress, (p) => p.workId, '作品进度');
  unique(parsed.listeningRecords, (r) => r.id, '聆听记录');
  unique(parsed.appMetadata, (m) => m.key, '应用元数据');
  const works = new Map(parsed.works.map((w) => [w.id, w]));
  const progress = new Map(parsed.workProgress.map((p) => [p.workId, p]));
  for (const item of parsed.workProgress) {
    const work = works.get(item.workId);
    if (!work || item.isHeard !== (item.status === 'completed'))
      throw new Error('进度引用不存在的作品或状态不一致。');
  }
  const seen = new Set<string>();
  const records = parsed.listeningRecords.filter((record) => {
    validateDate(record.datePrecision, record.dateValue);
    if (!works.has(record.workId) || progress.get(record.workId)?.status !== 'completed')
      throw new Error('聆听记录必须属于已听过的有效作品。');
    if (record.dateKey !== listeningDateKey(record.datePrecision, record.dateValue))
      throw new Error('日期去重键不匹配。');
    const key = JSON.stringify([record.workId, record.datePrecision, record.dateValue]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const composers = new Set(parsed.composers.map((composer) => composer.id));
  unique(parsed.composerPreferences, (row) => row.composerId, '作曲家偏好');
  unique(parsed.workPreferences, (row) => row.workId, '作品偏好');
  unique(parsed.workPublicLabels, (row) => row.id, '公共标签');
  if (
    parsed.composerPreferences.some((row) => !composers.has(row.composerId)) ||
    parsed.workPreferences.some((row) => !works.has(row.workId)) ||
    parsed.workPublicLabels.some((row) => !works.has(row.workId))
  )
    throw new Error('偏好或公共标签引用不存在的实体。');
  return {
    backup: { ...parsed, listeningRecords: records },
    mergedRecords: parsed.listeningRecords.length - records.length,
  };
}
