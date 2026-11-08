import type { ArchiveDB } from './database';
import { db } from './database';
import { listeningDateKey, localToday, validateDate } from '../domain/dates';
import { makeIdentifier, normalizeSearch } from '../domain/catalog';
import { calculateListeningStatistics } from '../domain/statistics';
import {
  composerSchema,
  workSchema,
  validateCatalog,
  composerPreferenceSchema,
  workPreferenceSchema,
  publicLabelSchema,
} from '../services/validation';
import {
  isCountable,
  type Composer,
  type ComposerPreference,
  type DateInput,
  type DatePrecision,
  type ListeningRecord,
  type ListeningStatus,
  type Work,
  type WorkAlias,
  type WorkIdentifier,
  type WorkPreference,
  type WorkProgress,
  type WorkPublicLabel,
  type WorkView,
} from '../domain/types';

type WorkSnapshot = { workId: string; progress?: WorkProgress; records: ListeningRecord[] };
export type UndoToken = { before: WorkSnapshot[]; after: string[] };
function fingerprint(snapshot: WorkSnapshot) {
  return JSON.stringify({
    ...snapshot,
    records: [...snapshot.records].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export class ArchiveRepository {
  constructor(
    readonly database: ArchiveDB = db,
    readonly clock: () => Date = () => new Date(),
  ) {}

  private timestamp() {
    return this.clock().toISOString();
  }
  private validateInput(date: DateInput) {
    validateDate(date.datePrecision, date.dateValue, localToday(this.clock()));
  }
  private async requireWork(workId: string) {
    if (!(await this.database.works.get(workId))) throw new Error('作品不存在。');
  }

  async getSnapshot(workId: string): Promise<WorkSnapshot> {
    return this.database.transaction(
      'r',
      [this.database.work_progress, this.database.listening_records],
      async () => ({
        workId,
        progress: await this.database.work_progress.get(workId),
        records: await this.database.listening_records.where('workId').equals(workId).toArray(),
      }),
    );
  }
  async mutate(
    workIds: string[],
    operation: (workId: string) => Promise<void>,
  ): Promise<UndoToken> {
    const database = this.database;
    return database.transaction(
      'rw',
      [database.works, database.work_progress, database.listening_records],
      async () => {
        const before: WorkSnapshot[] = [];
        const after: string[] = [];
        for (const workId of [...new Set(workIds)]) {
          const work = await database.works.get(workId);
          if (!work) throw new Error('作品不存在。');
          before.push(await this.getSnapshot(workId));
          await operation(workId);
          after.push(fingerprint(await this.getSnapshot(workId)));
        }
        return { before, after };
      },
    );
  }
  async undo(token: UndoToken) {
    const database = this.database;
    await database.transaction(
      'rw',
      [database.works, database.work_progress, database.listening_records],
      async () => {
        for (const [index, snapshot] of token.before.entries()) {
          await this.requireWork(snapshot.workId);
          if (fingerprint(await this.getSnapshot(snapshot.workId)) !== token.after[index])
            throw new Error('记录已在其他操作或标签页中改变，无法覆盖撤销。');
          await database.listening_records.where('workId').equals(snapshot.workId).delete();
          if (snapshot.progress) await database.work_progress.put(snapshot.progress);
          else await database.work_progress.delete(snapshot.workId);
          await database.listening_records.bulkPut(snapshot.records);
        }
      },
    );
  }
  async setHeard(workIds: string[], today: boolean) {
    return this.mutate(workIds, async (workId) => {
      const work = (await this.database.works.get(workId))!;
      if (!isCountable(work)) throw new Error('此条目不可独立统计聆听进度。');
      // Legacy UI quick action explicitly requests local today; the core API has no date default.
      await this.setStatus(
        workId,
        'completed',
        today
          ? {
              completedDate: { datePrecision: 'day', dateValue: localToday(this.clock()) },
            }
          : {},
      );
    });
  }

  async getStatus(workId: string): Promise<ListeningStatus> {
    return (await this.database.work_progress.get(workId))?.status ?? 'unheard';
  }
  async getRecords(workId: string) {
    return this.database.listening_records.where('workId').equals(workId).toArray();
  }
  async setStatus(
    workId: string,
    next: ListeningStatus,
    options: {
      completedDate?: DateInput;
      confirmClearHistory?: boolean;
    } = {},
  ) {
    if (!['unheard', 'partial', 'completed'].includes(next)) throw new Error('无效聆听状态。');
    if (options.completedDate) {
      if (next !== 'completed') throw new Error('只有完整听过才能保存完整聆听日期。');
      this.validateInput(options.completedDate);
    }
    return this.mutate([workId], async () => {
      const current = await this.getStatus(workId);
      if (current === 'completed' && next !== 'completed') {
        if (options.confirmClearHistory !== true) throw new Error('请明确确认清除完整聆听历史。');
        await this.database.listening_records.where('workId').equals(workId).delete();
      }
      await this.database.work_progress.put({
        workId,
        status: next,
        isHeard: next === 'completed',
        updatedAt: this.timestamp(),
      });
      if (options.completedDate) await this.insertRecord(workId, options.completedDate, true);
    });
  }
  private async insertRecord(workId: string, date: DateInput, allowExisting = false) {
    if ((await this.getStatus(workId)) !== 'completed')
      throw new Error('请先将作品标记为完整听过。');
    const dateKey = listeningDateKey(date.datePrecision, date.dateValue);
    const existing = await this.database.listening_records
      .where('[workId+dateKey]')
      .equals([workId, dateKey])
      .first();
    if (existing) {
      if (allowExisting) return existing;
      throw new Error('该日期和精度已有记录。');
    }
    const now = this.timestamp();
    const record: ListeningRecord = {
      id: crypto.randomUUID(),
      workId,
      ...date,
      dateKey,
      createdAt: now,
      updatedAt: now,
    };
    await this.database.listening_records.add(record);
    return record;
  }
  async addRecord(workId: string, date: DateInput): Promise<ListeningRecord> {
    this.validateInput(date);
    let record!: ListeningRecord;
    await this.mutate([workId], async () => {
      record = await this.insertRecord(workId, date);
    });
    return record;
  }
  async updateRecord(id: string, nextDate: DateInput) {
    this.validateInput(nextDate);
    const database = this.database;
    return database.transaction(
      'rw',
      [database.works, database.work_progress, database.listening_records],
      async () => {
        const record = await database.listening_records.get(id);
        if (!record) throw new Error('聆听记录已不存在。');
        await this.requireWork(record.workId);
        if ((await this.getStatus(record.workId)) !== 'completed')
          throw new Error('作品尚未完整听过。');
        await database.listening_records.put({
          ...record,
          ...nextDate,
          dateKey: listeningDateKey(nextDate.datePrecision, nextDate.dateValue),
          updatedAt: this.timestamp(),
        });
      },
    );
  }
  async saveRecord(
    workId: string,
    precision: DatePrecision,
    value: string | null,
    recordId?: string,
  ) {
    validateDate(precision, value, localToday(this.clock()));
    return this.mutate([workId], async () => {
      const now = this.timestamp();
      const existing = recordId ? await this.database.listening_records.get(recordId) : undefined;
      if (recordId && (!existing || existing.workId !== workId))
        throw new Error('聆听记录已不存在，请重新打开。');
      const duplicate = await this.database.listening_records
        .where('workId')
        .equals(workId)
        .filter((r) => r.id !== recordId && r.datePrecision === precision && r.dateValue === value)
        .first();
      if (duplicate) throw new Error('该日期和精度已有记录。');
      await this.database.work_progress.put({
        workId,
        status: 'completed',
        isHeard: true,
        updatedAt: now,
      });
      await this.database.listening_records.put({
        id: recordId ?? crypto.randomUUID(),
        workId,
        datePrecision: precision,
        dateValue: value,
        dateKey: listeningDateKey(precision, value),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    });
  }
  async deleteRecord(recordId: string): Promise<UndoToken>;
  async deleteRecord(workId: string, recordId: string): Promise<UndoToken>;
  async deleteRecord(workIdOrRecordId: string, suppliedRecordId?: string) {
    const found = suppliedRecordId
      ? undefined
      : await this.database.listening_records.get(workIdOrRecordId);
    const workId = suppliedRecordId ? workIdOrRecordId : found?.workId;
    const recordId = suppliedRecordId ?? workIdOrRecordId;
    if (!workId) throw new Error('聆听记录已不存在。');
    return this.mutate([workId], async () => {
      const record = await this.database.listening_records.get(recordId);
      if (!record || record.workId !== workId) throw new Error('聆听记录已不存在。');
      if ((await this.getStatus(workId)) !== 'completed') throw new Error('作品尚未完整听过。');
      await this.database.listening_records.delete(recordId);
      await this.database.work_progress.put({
        workId,
        status: 'completed',
        isHeard: true,
        updatedAt: this.timestamp(),
      });
    });
  }
  async resetUnheard(workId: string, options?: { confirmClearHistory?: boolean }) {
    return this.setStatus(workId, 'unheard', options);
  }
  async listComposers() {
    return this.database.composers.toArray();
  }
  async getComposer(id: string) {
    return this.database.composers.get(id);
  }
  async putComposer(composer: Composer) {
    await this.database.composers.put(composerSchema.parse(composer));
  }
  async getWork(id: string) {
    return this.database.works.get(id);
  }
  async listWorksByComposer(composerId: string) {
    return this.database.works.where('composerId').equals(composerId).toArray();
  }
  async putWork(work: Work) {
    const parsed = workSchema.parse(work);
    const database = this.database;
    await database.transaction('rw', [database.composers, database.works], async () => {
      const works = await database.works.toArray();
      validateCatalog({
        composers: await database.composers.toArray(),
        works: [...works.filter((item) => item.id !== parsed.id), parsed],
        workIdentifiers: [],
        workAliases: [],
        sourceMappings: [],
      });
      await database.works.put(parsed);
    });
  }
  async putIdentifier(identifier: WorkIdentifier) {
    const database = this.database;
    await database.transaction(
      'rw',
      [database.composers, database.works, database.work_identifiers],
      async () => {
        const existing = await database.work_identifiers.toArray();
        const catalog = validateCatalog({
          composers: await database.composers.toArray(),
          works: await database.works.toArray(),
          workIdentifiers: [...existing.filter((item) => item.id !== identifier.id), identifier],
          workAliases: [],
          sourceMappings: [],
        });
        await database.work_identifiers.put(
          catalog.workIdentifiers.find((item) => item.id === identifier.id)!,
        );
      },
    );
  }
  async putAlias(alias: WorkAlias) {
    const database = this.database;
    await database.transaction(
      'rw',
      [database.composers, database.works, database.work_aliases],
      async () => {
        const catalog = validateCatalog({
          composers: await database.composers.toArray(),
          works: await database.works.toArray(),
          workIdentifiers: [],
          workAliases: [alias],
          sourceMappings: [],
        });
        await database.work_aliases.put(catalog.workAliases[0]!);
      },
    );
  }
  async putComposerPreference(preference: ComposerPreference) {
    const parsed = composerPreferenceSchema.parse(preference);
    const database = this.database;
    await database.transaction(
      'rw',
      [database.composers, database.composer_preferences],
      async () => {
        if (!(await database.composers.get(parsed.composerId))) throw new Error('作曲家不存在。');
        await database.composer_preferences.put(parsed);
      },
    );
  }
  async getComposerPreference(composerId: string) {
    return this.database.composer_preferences.get(composerId);
  }
  async getWorkPreference(workId: string) {
    return this.database.work_preferences.get(workId);
  }
  async setComposerPreference(
    composerId: string,
    field: 'isFollowing' | 'isFavorite',
    value: boolean,
  ) {
    const database = this.database;
    await database.transaction(
      'rw',
      [database.composers, database.composer_preferences],
      async () => {
        if (!(await database.composers.get(composerId))) throw new Error('作曲家不存在。');
        const current = await this.getComposerPreference(composerId);
        if ((current?.[field] ?? false) === value) return;
        await database.composer_preferences.put(
          composerPreferenceSchema.parse({
            composerId,
            isFollowing: false,
            isFavorite: false,
            ...current,
            [field]: value,
            updatedAt: this.timestamp(),
          }),
        );
      },
    );
  }
  async setWorkPreference(workId: string, field: 'isFavorite' | 'isInQueue', value: boolean) {
    const database = this.database;
    await database.transaction('rw', [database.works, database.work_preferences], async () => {
      await this.requireWork(workId);
      const current = await this.getWorkPreference(workId);
      if ((current?.[field] ?? false) === value) return;
      await database.work_preferences.put(
        workPreferenceSchema.parse({
          workId,
          isFavorite: false,
          isInQueue: false,
          ...current,
          [field]: value,
          updatedAt: this.timestamp(),
        }),
      );
    });
  }
  async preferredComposers() {
    const database = this.database;
    return database.transaction(
      'r',
      [database.composers, database.composer_preferences],
      async () => {
        const preferences = (await database.composer_preferences.toArray()).filter(
          (row) => row.isFollowing || row.isFavorite,
        );
        const composers = await database.composers.bulkGet(
          preferences.map((row) => row.composerId),
        );
        return composers.flatMap((composer, index) =>
          composer ? [{ ...composer, preference: preferences[index]! }] : [],
        );
      },
    );
  }
  async preferredWorks() {
    const database = this.database;
    return database.transaction(
      'r',
      [
        database.works,
        database.composers,
        database.work_preferences,
        database.work_identifiers,
        database.work_aliases,
        database.work_progress,
        database.listening_records,
      ],
      async () => {
        const preferences = (await database.work_preferences.toArray()).filter(
          (row) => row.isFavorite || row.isInQueue,
        );
        const items = await database.works.bulkGet(preferences.map((row) => row.workId));
        const works = items.filter((work): work is Work => Boolean(work));
        const views = await this.workViews(works);
        const composers = new Map((await database.composers.toArray()).map((row) => [row.id, row]));
        const byId = new Map(preferences.map((row) => [row.workId, row]));
        return views.flatMap((work) => {
          const composer = composers.get(work.composerId);
          return composer ? [{ ...work, composer, preference: byId.get(work.id)! }] : [];
        });
      },
    );
  }
  async putWorkPreference(preference: WorkPreference) {
    const parsed = workPreferenceSchema.parse(preference);
    const database = this.database;
    await database.transaction('rw', [database.works, database.work_preferences], async () => {
      await this.requireWork(parsed.workId);
      await database.work_preferences.put(parsed);
    });
  }
  async putPublicLabel(label: WorkPublicLabel) {
    const parsed = publicLabelSchema.parse(label);
    const database = this.database;
    await database.transaction('rw', [database.works, database.work_public_labels], async () => {
      await this.requireWork(parsed.workId);
      await database.work_public_labels.put(parsed);
    });
  }
  async listWorks(composerId: string): Promise<WorkView[]> {
    const database = this.database;
    return database.transaction(
      'r',
      [
        database.works,
        database.work_identifiers,
        database.work_aliases,
        database.work_progress,
        database.listening_records,
      ],
      async () => {
        const works = await database.works.where('composerId').equals(composerId).toArray();
        return this.workViews(works);
      },
    );
  }
  private async workViews(works: Work[]): Promise<WorkView[]> {
    const database = this.database;
    const ids = works.map((work) => work.id);
    const [identifiers, aliases, progress, records] = await Promise.all([
      database.work_identifiers.where('workId').anyOf(ids).toArray(),
      database.work_aliases.where('workId').anyOf(ids).toArray(),
      database.work_progress.bulkGet(ids),
      database.listening_records.where('workId').anyOf(ids).toArray(),
    ]);
    const group = <T extends { workId: string }>(values: T[]) => {
      const map = new Map<string, T[]>();
      for (const value of values) map.set(value.workId, [...(map.get(value.workId) ?? []), value]);
      return map;
    };
    const idMap = group(identifiers),
      aliasMap = group(aliases),
      recordMap = group(records);
    return works.map((work, index) => ({
      ...work,
      identifiers: idMap.get(work.id) ?? [],
      aliases: aliasMap.get(work.id) ?? [],
      progress: progress[index],
      records: recordMap.get(work.id) ?? [],
    }));
  }
  async composerSummaries() {
    const database = this.database;
    return database.transaction(
      'r',
      [database.composers, database.works, database.work_progress, database.composer_preferences],
      async () => {
        const [composers, works, progress] = await Promise.all([
          database.composers.toArray(),
          database.works.toArray(),
          database.work_progress.toArray(),
        ]);
        const heard = new Set(
          progress.filter((p) => p.status === 'completed').map((p) => p.workId),
        );
        const preferences = new Map(
          (await database.composer_preferences.toArray()).map((row) => [row.composerId, row]),
        );
        return composers.map((composer) => {
          const items = works.filter((w) => w.composerId === composer.id && isCountable(w));
          return {
            ...composer,
            preference: preferences.get(composer.id),
            total: items.length,
            heard: items.filter((w) => heard.has(w.id)).length,
          };
        });
      },
    );
  }
  async listeningStatistics() {
    const database = this.database;
    return database.transaction(
      'r',
      [database.composers, database.works, database.work_progress, database.listening_records],
      async () => {
        const [composers, works, progress, records] = await Promise.all([
          database.composers.toArray(),
          database.works.toArray(),
          database.work_progress.toArray(),
          database.listening_records.toArray(),
        ]);
        return calculateListeningStatistics(composers, works, progress, records);
      },
    );
  }
  async addManualWork(
    input: Omit<Work, 'id' | 'userCreated'>,
    identifiers: { system: string; value: string }[],
    aliases: string[],
  ) {
    const database = this.database;
    const workId = crypto.randomUUID();
    return database.transaction(
      'rw',
      [database.composers, database.works, database.work_identifiers, database.work_aliases],
      async () => {
        if (!input.titleOriginal.trim()) throw new Error('请填写可读作品名称。');
        const composer = await database.composers.get(input.composerId);
        if (!composer) throw new Error('作曲家不存在。');
        if (input.parentWorkId) {
          const parent = await database.works.get(input.parentWorkId);
          if (!parent || parent.composerId !== input.composerId)
            throw new Error('上级作品不属于此作曲家。');
        }
        const works = await database.works.where('composerId').equals(input.composerId).toArray();
        if (
          works.some(
            (w) => normalizeSearch(w.titleOriginal) === normalizeSearch(input.titleOriginal),
          )
        )
          throw new Error('同名作品已存在，请先检查目录。');
        const existing = await database.work_identifiers
          .where('workId')
          .anyOf(works.map((w) => w.id))
          .toArray();
        for (const identifier of identifiers) {
          const candidate = makeIdentifier(workId, identifier.system, identifier.value);
          if (
            existing.some(
              (i) =>
                i.system === candidate.system && i.normalizedValue === candidate.normalizedValue,
            )
          )
            throw new Error('此作曲家的作品编号已存在，请先检查目录。');
        }
        const newWork = workSchema.parse({ ...input, id: workId, userCreated: true });
        const newIdentifiers = identifiers.map((i, index) =>
          makeIdentifier(workId, i.system, i.value, index === 0),
        );
        const newAliases = aliases
          .filter((text) => text.trim())
          .map((text) => ({ id: crypto.randomUUID(), workId, text: text.trim(), kind: 'user' }));
        validateCatalog({
          composers: [composer],
          works: [...works, newWork],
          workIdentifiers: [...existing, ...newIdentifiers],
          workAliases: newAliases,
          sourceMappings: [],
        });
        await database.works.add(newWork);
        await database.work_identifiers.bulkAdd(newIdentifiers);
        await database.work_aliases.bulkAdd(newAliases);
        return workId;
      },
    );
  }
}

export const repository = new ArchiveRepository();
