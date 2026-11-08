import Dexie, { type Table } from 'dexie';
import { normalizeWork } from '../domain/types';
import { listeningDateKey, validateDate } from '../domain/dates';
import type {
  AppMetadata,
  Composer,
  ListeningRecord,
  SourceMapping,
  Work,
  WorkAlias,
  WorkIdentifier,
  WorkProgress,
  ComposerPreference,
  WorkPreference,
  WorkPublicLabel,
} from '../domain/types';

export const schemaV1 = {
  composers: 'id, nameOriginal',
  works: 'id, composerId, parentWorkId',
  work_identifiers: 'id, workId, normalizedValue, [system+normalizedValue]',
  work_aliases: 'id, workId',
  work_progress: 'workId',
  listening_records: 'id, workId, &[workId+datePrecision+dateValue]',
  source_mappings: 'id, &[sourceName+entityType+sourceId], internalId',
  app_metadata: 'key',
};

export const schemaV2 = {
  ...schemaV1,
  works: 'id, composerId, parentWorkId, countPolicy',
  listening_records: 'id, workId, &[workId+dateKey]',
  composer_preferences: 'composerId',
  work_preferences: 'workId',
  work_public_labels: 'id, workId, labelType, [workId+labelType]',
};

export class ArchiveDB extends Dexie {
  composers!: Table<Composer, string>;
  works!: Table<Work, string>;
  work_identifiers!: Table<WorkIdentifier, string>;
  work_aliases!: Table<WorkAlias, string>;
  work_progress!: Table<WorkProgress, string>;
  listening_records!: Table<ListeningRecord, string>;
  source_mappings!: Table<SourceMapping, string>;
  app_metadata!: Table<AppMetadata, string>;
  composer_preferences!: Table<ComposerPreference, string>;
  work_preferences!: Table<WorkPreference, string>;
  work_public_labels!: Table<WorkPublicLabel, string>;

  constructor(name = 'classical-listening-archive') {
    super(name);
    this.version(1).stores(schemaV1);
    this.version(2)
      .stores(schemaV2)
      .upgrade(async (transaction) => {
        const works = transaction.table<Work, string>('works');
        const progress = transaction.table<WorkProgress, string>('work_progress');
        const records = transaction.table<ListeningRecord, string>('listening_records');
        const workIds = new Set((await works.toArray()).map((work) => work.id));
        await works.toCollection().modify((work) => {
          Object.assign(work, normalizeWork(work));
        });
        await progress.toCollection().modify((row) => {
          if (!workIds.has(row.workId) || typeof row.isHeard !== 'boolean')
            throw new Error('旧进度结构异常，升级已回滚，请先导出原数据供复核。');
          const status = row.isHeard ? 'completed' : 'unheard';
          if (row.status !== undefined && row.status !== status)
            throw new Error('旧进度包含冲突状态，升级已回滚，请复核原数据。');
          row.status = status;
        });
        const completed = new Set(
          (await progress.toArray())
            .filter((row) => row.status === 'completed')
            .map((row) => row.workId),
        );
        await records.toCollection().modify((record) => {
          if (!completed.has(record.workId))
            throw new Error('旧日期缺少明确的已听状态，升级已回滚，请复核原数据。');
          validateDate(record.datePrecision, record.dateValue, '9999-12-31');
          record.dateKey = listeningDateKey(record.datePrecision, record.dateValue);
        });
        // Duplicate unknown dates cause the unique index to abort the whole upgrade.
        // Never discard an old record/ID to make an ambiguous migration pass.
        await transaction.table('app_metadata').put({ key: 'schemaVersion', value: 2 });
      });
    this.on('populate', (transaction) =>
      transaction
        .table('app_metadata')
        .put({ key: 'schemaVersion', value: 2 })
        .then(() => undefined),
    );
  }
}

export const db = new ArchiveDB();
