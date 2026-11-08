import { db, type ArchiveDB } from '../db/database';
import { localToday } from '../domain/dates';
import type { Backup } from '../domain/types';
import { validateBackup } from './validation';

export async function exportBackup(database: ArchiveDB = db): Promise<Backup> {
  return database.transaction('r', database.tables, async () => {
    const [
      composers,
      works,
      workIdentifiers,
      workAliases,
      workProgress,
      listeningRecords,
      sourceMappings,
      appMetadata,
      composerPreferences,
      workPreferences,
      workPublicLabels,
    ] = await Promise.all([
      database.composers.toArray(),
      database.works.toArray(),
      database.work_identifiers.toArray(),
      database.work_aliases.toArray(),
      database.work_progress.toArray(),
      database.listening_records.toArray(),
      database.source_mappings.toArray(),
      database.app_metadata.toArray(),
      database.composer_preferences.toArray(),
      database.work_preferences.toArray(),
      database.work_public_labels.toArray(),
    ]);
    return validateBackup({
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      composers,
      works,
      workIdentifiers,
      workAliases,
      workProgress,
      listeningRecords,
      sourceMappings,
      appMetadata,
      composerPreferences,
      workPreferences,
      workPublicLabels,
    }).backup;
  });
}

export const maxBackupBytes = 100 * 1024 * 1024;
export function parseBackup(json: string) {
  if (new TextEncoder().encode(json).byteLength > maxBackupBytes)
    throw new Error('备份超过 100 MB，请联系维护者。');
  try {
    return validateBackup(JSON.parse(json));
  } catch (error) {
    throw new Error(
      `备份未通过校验，现有数据未改变。${error instanceof Error ? error.message : ''}`,
      { cause: error },
    );
  }
}

export async function restoreBackup(value: unknown, database: ArchiveDB = db) {
  const { backup } = validateBackup(value);
  await database.transaction('rw', database.tables, async () => {
    for (const table of database.tables) await table.clear();
    await database.composers.bulkAdd(backup.composers);
    await database.works.bulkAdd(backup.works);
    await database.work_identifiers.bulkAdd(backup.workIdentifiers);
    await database.work_aliases.bulkAdd(backup.workAliases);
    await database.work_progress.bulkAdd(backup.workProgress);
    await database.listening_records.bulkAdd(backup.listeningRecords);
    await database.source_mappings.bulkAdd(backup.sourceMappings);
    await database.app_metadata.bulkAdd(backup.appMetadata);
    await database.composer_preferences.bulkAdd(backup.composerPreferences);
    await database.work_preferences.bulkAdd(backup.workPreferences);
    await database.work_public_labels.bulkAdd(backup.workPublicLabels);
    await database.app_metadata.put({ key: 'schemaVersion', value: 2 });
    await database.app_metadata.put({ key: 'restoredAt', value: new Date().toISOString() });
    // An explicitly restored backup is authoritative; don't reseed a deliberately empty archive.
    await database.app_metadata.put({ key: 'initialized', value: true });
  });
}

export async function downloadBackup() {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `classical-listening-backup-${localToday()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
