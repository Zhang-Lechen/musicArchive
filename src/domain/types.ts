export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';
export type CatalogCoverage = 'sample' | 'partial' | 'verified';
export type ListeningStatus = 'unheard' | 'partial' | 'completed';
export type WorkNodeType = 'standalone' | 'collection' | 'movement' | 'excerpt' | 'part';
export type CountPolicy = 'countable' | 'container' | 'noncountable';
export type PublicLabelType = 'popular' | 'source_recommended' | 'representative';
export type ReviewStatus = 'source_provided' | 'pending' | 'reviewed';
export type DateInput =
  | { datePrecision: 'unknown'; dateValue: null }
  | { datePrecision: Exclude<DatePrecision, 'unknown'>; dateValue: string };
export type Source = {
  name: string;
  url: string;
  license: string;
  retrievedAt: string;
  catalogEdition?: string;
};
export type Composer = {
  id: string;
  nameOriginal: string;
  nameZh?: string;
  aliases: string[];
  birthYear?: number;
  deathYear?: number;
  era?: string;
  primaryCatalog?: string;
  coverageStatus: CatalogCoverage;
  source?: Source;
};
export type Work = {
  id: string;
  composerId: string;
  titleOriginal: string;
  titleZh?: string;
  genre?: string;
  key?: string;
  parentWorkId?: string;
  kind: 'work' | 'collection' | 'movement';
  // Optional only for compatibility with existing v1 catalogs and callers.
  // Repositories, catalog validation and the v2 upgrade materialize these fields.
  nodeType?: WorkNodeType;
  countPolicy?: CountPolicy;
  isPerformable?: boolean;
  primaryGenre?: string;
  catalogStatus: 'confirmed' | 'doubtful' | 'lost' | 'fragment';
  source?: Source;
  userCreated?: boolean;
};
export type WorkIdentifier = {
  id: string;
  workId: string;
  system: string;
  value: string;
  normalizedValue: string;
  sortKey: string;
  isPrimary: boolean;
  edition?: string;
  source?: Source;
};
export type WorkAlias = {
  id: string;
  workId: string;
  text: string;
  locale?: string;
  kind?: string;
};
export type WorkProgress = {
  workId: string;
  status: ListeningStatus;
  /** Compatibility projection for the existing UI; always status === 'completed'. */
  isHeard: boolean;
  updatedAt: string;
};
export type ListeningRecord = {
  id: string;
  workId: string;
  datePrecision: DatePrecision;
  dateValue: string | null;
  dateKey: string;
  createdAt: string;
  updatedAt: string;
};
export type SourceMapping = {
  id: string;
  entityType: 'composer' | 'work';
  internalId: string;
  sourceName: string;
  sourceId: string;
  lastSeenAt: string;
};
export type AppMetadata = { key: string; value: unknown };
export type ComposerPreference = {
  composerId: string;
  isFollowing: boolean;
  isFavorite: boolean;
  updatedAt: string;
};
export type WorkPreference = {
  workId: string;
  isFavorite: boolean;
  isInQueue: boolean;
  updatedAt: string;
};
export type WorkPublicLabel = {
  id: string;
  workId: string;
  labelType: PublicLabelType;
  sourceName: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceDate?: string;
  reviewStatus: ReviewStatus;
  methodVersion?: string;
};
export type Catalog = {
  composers: Composer[];
  works: Work[];
  workIdentifiers: WorkIdentifier[];
  workAliases: WorkAlias[];
  sourceMappings: SourceMapping[];
};
export type Backup = Catalog & {
  formatVersion: 2;
  exportedAt: string;
  workProgress: WorkProgress[];
  listeningRecords: ListeningRecord[];
  appMetadata: AppMetadata[];
  composerPreferences: ComposerPreference[];
  workPreferences: WorkPreference[];
  workPublicLabels: WorkPublicLabel[];
};
export type WorkView = Work & {
  identifiers: WorkIdentifier[];
  aliases: WorkAlias[];
  progress?: WorkProgress;
  records: ListeningRecord[];
};
export function isCountable(work: Work) {
  return (
    (work.countPolicy ?? legacyWorkStructure(work).countPolicy) === 'countable' &&
    (work.isPerformable ?? work.catalogStatus !== 'lost') &&
    work.catalogStatus === 'confirmed'
  );
}

/** Conservative v1 defaults; a child/leaf is never automatically independent. */
export function legacyWorkStructure(
  work: Pick<Work, 'kind' | 'parentWorkId' | 'catalogStatus' | 'nodeType'>,
) {
  const nodeType = work.nodeType ?? (work.kind === 'work' ? 'standalone' : work.kind);
  return {
    nodeType,
    countPolicy:
      nodeType === 'collection'
        ? ('container' as const)
        : nodeType === 'standalone' && !work.parentWorkId
          ? ('countable' as const)
          : ('noncountable' as const),
    isPerformable: work.catalogStatus !== 'lost',
  };
}

export function normalizeWork(work: Work) {
  const defaults = legacyWorkStructure(work);
  return {
    ...work,
    nodeType: work.nodeType ?? defaults.nodeType,
    countPolicy: work.countPolicy ?? defaults.countPolicy,
    isPerformable: work.isPerformable ?? defaults.isPerformable,
  };
}
