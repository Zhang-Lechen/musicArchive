import 'fake-indexeddb/auto';
import { ArchiveDB } from '../db/database';

export async function testDatabase() {
  const database = new ArchiveDB(`test-${crypto.randomUUID()}`);
  await database.composers.add({
    id: 'composer',
    nameOriginal: 'Test composer',
    aliases: [],
    coverageStatus: 'sample',
  });
  await database.works.bulkAdd(
    ['first', 'second'].map((id) => ({
      id,
      composerId: 'composer',
      titleOriginal: id,
      kind: 'work' as const,
      catalogStatus: 'confirmed' as const,
    })),
  );
  return database;
}
