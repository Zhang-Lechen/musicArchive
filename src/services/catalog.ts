import { db, type ArchiveDB } from '../db/database';
import { canonicalSystem, normalizeSearch } from '../domain/catalog';
import { isCountable, type Catalog, type Composer, type Work } from '../domain/types';
import { validateCatalog } from './validation';

export const bundledCatalogVersion = '2026.11.04.1';
export interface CatalogProvider {
  load(): Promise<Catalog>;
}
export const bundledCatalogProvider: CatalogProvider = {
  async load() {
    const url = import.meta.env.DEV ? '/src/data/catalog.json' : '/catalog.json';
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('本地目录资源无法读取，请重新加载。');
    return validateCatalog(await response.json());
  },
};

export async function readCatalog(database: ArchiveDB): Promise<Catalog> {
  const [composers, works, workIdentifiers, workAliases, sourceMappings] = await Promise.all([
    database.composers.toArray(),
    database.works.toArray(),
    database.work_identifiers.toArray(),
    database.work_aliases.toArray(),
    database.source_mappings.toArray(),
  ]);
  return { composers, works, workIdentifiers, workAliases, sourceMappings };
}

export function planCatalogMerge(existing: Catalog, incoming: Catalog) {
  const composers = new Map(existing.composers.map((c) => [c.id, c]));
  const works = new Map(existing.works.map((w) => [w.id, w]));
  const identifiers = new Map(existing.workIdentifiers.map((i) => [i.id, i]));
  const aliases = new Map(existing.workAliases.map((a) => [a.id, a]));
  const mappings = new Map(
    existing.sourceMappings.map((m) => [
      JSON.stringify([m.sourceName, m.entityType, m.sourceId]),
      m,
    ]),
  );
  const remapComposer = new Map<string, string>(),
    remapWork = new Map<string, string>();
  const incomingMappingGroups = new Map<string, typeof incoming.sourceMappings>();
  for (const mapping of incoming.sourceMappings) {
    const key = `${mapping.entityType}|${mapping.internalId}`;
    incomingMappingGroups.set(key, [...(incomingMappingGroups.get(key) ?? []), mapping]);
  }
  const sourceTarget = (type: 'composer' | 'work', id: string) => {
    const targets = new Set(
      (incomingMappingGroups.get(`${type}|${id}`) ?? [])
        .map(
          (m) => mappings.get(JSON.stringify([m.sourceName, m.entityType, m.sourceId]))?.internalId,
        )
        .filter((id): id is string => Boolean(id)),
    );
    if (targets.size > 1) throw new Error('来源映射冲突，请人工复核后导入。');
    return [...targets][0];
  };
  for (const composer of incoming.composers) {
    const id = sourceTarget('composer', composer.id) ?? composer.id;
    const old = composers.get(id);
    composers.set(id, {
      ...old,
      ...composer,
      id,
      nameZh: composer.nameZh ?? old?.nameZh,
      aliases: [...new Set([...(old?.aliases ?? []), ...composer.aliases])],
    } satisfies Composer);
    remapComposer.set(composer.id, id);
  }
  // Match manual entries to incoming source IDs by unambiguous identifiers; names alone never silently merge.
  const byNumber = new Map<string, Set<string>>();
  const existingTitles = new Set(
    existing.works.map((work) =>
      JSON.stringify([work.composerId, normalizeSearch(work.titleOriginal)]),
    ),
  );
  for (const identifier of existing.workIdentifiers) {
    const work = works.get(identifier.workId);
    if (!work) continue;
    const key = `${work.composerId}|${canonicalSystem(identifier.system)}|${identifier.normalizedValue}`;
    const candidates = byNumber.get(key) ?? new Set<string>();
    candidates.add(work.id);
    byNumber.set(key, candidates);
  }
  const incomingIdentifiers = new Map<string, typeof incoming.workIdentifiers>();
  const incomingNumberWorks = new Map<string, Set<string>>();
  for (const item of incoming.workIdentifiers)
    incomingIdentifiers.set(item.workId, [...(incomingIdentifiers.get(item.workId) ?? []), item]);
  for (const work of incoming.works) {
    for (const identifier of incomingIdentifiers.get(work.id) ?? []) {
      const key = `${remapComposer.get(work.composerId)}|${canonicalSystem(identifier.system)}|${identifier.normalizedValue}`;
      const ids = incomingNumberWorks.get(key) ?? new Set<string>();
      ids.add(work.id);
      incomingNumberWorks.set(key, ids);
    }
  }
  const existingWorkMappings = new Map<string, typeof existing.sourceMappings>();
  for (const mapping of existing.sourceMappings)
    if (mapping.entityType === 'work')
      existingWorkMappings.set(mapping.internalId, [
        ...(existingWorkMappings.get(mapping.internalId) ?? []),
        mapping,
      ]);
  for (const work of incoming.works) {
    const composerId = remapComposer.get(work.composerId)!;
    let target = sourceTarget('work', work.id);
    if (!target && works.has(work.id)) target = work.id;
    if (!target) {
      const possible = new Set(
        (incomingIdentifiers.get(work.id) ?? []).flatMap((i) => [
          ...(byNumber.get(`${composerId}|${canonicalSystem(i.system)}|${i.normalizedValue}`) ??
            []),
        ]),
      );
      const incomingSources = incomingMappingGroups.get(`work|${work.id}`) ?? [];
      const candidates = new Set(
        [...possible].filter(
          (candidate) =>
            !incomingSources.some((source) =>
              (existingWorkMappings.get(candidate) ?? []).some(
                (old) => old.sourceName === source.sourceName && old.sourceId !== source.sourceId,
              ),
            ),
        ),
      );
      if (candidates.size > 1)
        throw new Error(`编号匹配多个已有作品：${work.titleOriginal}，请人工复核。`);
      target = [...candidates][0];
      if (target) {
        for (const identifier of incomingIdentifiers.get(work.id) ?? []) {
          const key = `${composerId}|${canonicalSystem(identifier.system)}|${identifier.normalizedValue}`;
          if ((incomingNumberWorks.get(key)?.size ?? 0) > 1)
            throw new Error(`导入目录内同编号对应多个作品：${identifier.value}，请人工复核。`);
          const old = existing.workIdentifiers.find(
            (i) =>
              i.workId === target &&
              i.system === identifier.system &&
              i.normalizedValue === identifier.normalizedValue,
          );
          if (old?.edition && identifier.edition && old.edition !== identifier.edition)
            throw new Error('同号目录版次不同，请人工复核后建立来源映射。');
        }
      }
      if (
        !target &&
        existingTitles.has(JSON.stringify([composerId, normalizeSearch(work.titleOriginal)]))
      )
        throw new Error(`同名作品缺少可靠编号映射：${work.titleOriginal}，请人工复核。`);
    }
    const id = target ?? work.id;
    const old = works.get(id);
    if (old && old.composerId !== composerId) throw new Error('作品内部 ID 与作曲家关联冲突。');
    works.set(id, {
      ...old,
      ...work,
      id,
      composerId,
      titleZh: work.titleZh ?? old?.titleZh,
      ...(old?.userCreated
        ? {
            titleOriginal: old.titleOriginal,
            titleZh: old.titleZh ?? work.titleZh,
            userCreated: true,
            kind: old.kind,
            nodeType: old.nodeType,
            countPolicy: old.countPolicy,
            isPerformable: old.isPerformable,
            parentWorkId: old.parentWorkId,
            catalogStatus: old.catalogStatus,
          }
        : {}),
    } satisfies Work);
    remapWork.set(work.id, id);
  }
  for (const work of incoming.works) {
    if (work.parentWorkId) {
      const target = works.get(remapWork.get(work.id)!)!;
      if (!target.userCreated) target.parentWorkId = remapWork.get(work.parentWorkId);
    }
  }
  const existingNumbers = new Map(
    existing.workIdentifiers.map((i) => [
      `${i.workId}|${i.system}|${i.normalizedValue}|${i.edition ?? ''}`,
      i,
    ]),
  );
  const hasPrimary = new Set(
    existing.workIdentifiers.filter((i) => i.isPrimary).map((i) => i.workId),
  );
  for (const identifier of incoming.workIdentifiers) {
    const workId = remapWork.get(identifier.workId)!;
    const old = existingNumbers.get(
      `${workId}|${identifier.system}|${identifier.normalizedValue}|${identifier.edition ?? ''}`,
    );
    const byId = identifiers.get(identifier.id);
    const prior = old ?? (byId?.workId === workId ? byId : undefined);
    const id = prior?.id ?? (byId ? crypto.randomUUID() : identifier.id);
    const isPrimary = prior?.isPrimary ?? (identifier.isPrimary && !hasPrimary.has(workId));
    identifiers.set(id, { ...identifier, id, workId, isPrimary });
    if (isPrimary) hasPrimary.add(workId);
  }
  const aliasKeys = new Set(existing.workAliases.map((a) => `${a.workId}|${a.text}`));
  for (const alias of incoming.workAliases) {
    const workId = remapWork.get(alias.workId)!;
    if (aliasKeys.has(`${workId}|${alias.text}`)) continue;
    const id = aliases.has(alias.id) ? crypto.randomUUID() : alias.id;
    aliases.set(id, { ...alias, id, workId });
    aliasKeys.add(`${workId}|${alias.text}`);
  }
  const mappingIds = new Set(existing.sourceMappings.map((m) => m.id));
  for (const mapping of incoming.sourceMappings) {
    const key = JSON.stringify([mapping.sourceName, mapping.entityType, mapping.sourceId]);
    const old = mappings.get(key);
    const id = old?.id ?? (mappingIds.has(mapping.id) ? crypto.randomUUID() : mapping.id);
    mappings.set(key, {
      ...mapping,
      id,
      internalId: (mapping.entityType === 'composer' ? remapComposer : remapWork).get(
        mapping.internalId,
      )!,
    });
    mappingIds.add(id);
  }
  const merged = validateCatalog({
    composers: [...composers.values()],
    works: [...works.values()],
    workIdentifiers: [...identifiers.values()],
    workAliases: [...aliases.values()],
    sourceMappings: [...mappings.values()],
  });
  return {
    catalog: merged,
    addedComposers: merged.composers.length - existing.composers.length,
    addedWorks: merged.works.length - existing.works.length,
    matchedWorks: incoming.works.length - (merged.works.length - existing.works.length),
  };
}

export async function previewCatalog(value: unknown, database = db) {
  const incoming = validateCatalog(value);
  return database.transaction(
    'r',
    [
      database.composers,
      database.works,
      database.work_identifiers,
      database.work_aliases,
      database.source_mappings,
    ],
    async () => planCatalogMerge(await readCatalog(database), incoming),
  );
}

export async function importCatalog(value: unknown, database: ArchiveDB = db, version?: string) {
  const incoming = validateCatalog(value);
  return database.transaction('rw', database.tables, async () => {
    const plan = planCatalogMerge(await readCatalog(database), incoming);
    const nextWorks = new Map(plan.catalog.works.map((w) => [w.id, w]));
    // Metadata refresh may not invalidate a user's heard state (e.g. upstream changes status to lost).
    for (const progress of await database.work_progress.toArray()) {
      if (!progress.isHeard) continue;
      const old = await database.works.get(progress.workId);
      const next = nextWorks.get(progress.workId);
      if (old && next && !isCountable(next)) {
        next.catalogStatus = old.catalogStatus;
        next.parentWorkId = old.parentWorkId;
        next.kind = old.kind;
        next.nodeType = old.nodeType;
        next.countPolicy = old.countPolicy;
        next.isPerformable = old.isPerformable;
      }
    }
    await database.composers.bulkPut(plan.catalog.composers);
    await database.works.bulkPut(plan.catalog.works);
    await database.work_identifiers.bulkPut(plan.catalog.workIdentifiers);
    await database.work_aliases.bulkPut(plan.catalog.workAliases);
    await database.source_mappings.bulkPut(plan.catalog.sourceMappings);
    if (version) await database.app_metadata.put({ key: 'catalogVersion', value: version });
    return {
      addedComposers: plan.addedComposers,
      addedWorks: plan.addedWorks,
      matchedWorks: plan.matchedWorks,
    };
  });
}

export async function initializeSeed(database: ArchiveDB, seed: Catalog, version = '1') {
  const catalog = validateCatalog(seed);
  await database.transaction('rw', database.tables, async () => {
    if (
      (await database.app_metadata.get('seedVersion'))?.value === version ||
      (await database.app_metadata.get('restoredAt'))
    )
      return;
    const first = !(await database.app_metadata.get('initialized'));
    if (first) {
      await database.composers.bulkAdd(catalog.composers);
      await database.works.bulkAdd(catalog.works);
      await database.work_identifiers.bulkAdd(catalog.workIdentifiers);
      await database.work_aliases.bulkAdd(catalog.workAliases);
      await database.source_mappings.bulkAdd(catalog.sourceMappings);
      await database.app_metadata.put({ key: 'initialized', value: true });
    } else await importCatalog(catalog, database);
    await database.app_metadata.put({ key: 'seedVersion', value: version });
  });
}

const initializations = new WeakMap<ArchiveDB, Promise<void>>();
export function initializeArchive(database = db) {
  const current = initializations.get(database);
  if (current) return current;
  const promise = bootstrapArchive(database).catch((error: unknown) => {
    initializations.delete(database);
    throw error;
  });
  initializations.set(database, promise);
  return promise;
}
async function bootstrapArchive(database: ArchiveDB) {
  const seed = validateCatalog(JSON.parse((await import('../data/seed.json?raw')).default));
  await initializeSeed(database, seed);
  if (
    (await database.app_metadata.get('restoredAt')) ||
    (await database.app_metadata.get('catalogVersion'))?.value === bundledCatalogVersion
  )
    return;
  await importCatalog(await bundledCatalogProvider.load(), database, bundledCatalogVersion);
}
