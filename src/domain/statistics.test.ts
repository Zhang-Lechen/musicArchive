import { describe, expect, it } from 'vitest';
import { calculateListeningStatistics as calculate, topListeningComposers } from './statistics';
import type { Composer, ListeningRecord, Work, WorkProgress } from './types';

const composers: Composer[] = ['a', 'b'].map((id) => ({
  id,
  nameOriginal: id,
  aliases: [],
  coverageStatus: 'sample',
}));
function work(id: string, extra: Partial<Work> = {}): Work {
  return {
    id,
    composerId: 'a',
    titleOriginal: 'Same title',
    kind: 'work',
    nodeType: 'standalone',
    countPolicy: 'countable',
    catalogStatus: 'confirmed',
    ...extra,
  };
}
function progress(workId: string, status: WorkProgress['status'] = 'completed'): WorkProgress {
  return { workId, status, isHeard: status === 'completed', updatedAt: '2026-01-01' };
}
function record(
  workId: string,
  dateValue: string | null,
  datePrecision: ListeningRecord['datePrecision'] = 'year',
): ListeningRecord {
  return {
    id: crypto.randomUUID(),
    workId,
    dateValue,
    datePrecision,
    dateKey: '',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

describe('聆听统计投影', () => {
  it('空目录、无聆听和仅部分听过都保持有限的零值与空图表', () => {
    expect(calculate([], [], [], [])).toMatchObject({
      total: 0,
      completed: 0,
      coverage: 0,
      partial: 0,
      composerCount: 0,
      composers: [],
      genres: [],
      years: [],
      unknownDateCount: 0,
    });
    expect(
      calculate(composers, [work('1')], [progress('1', 'partial')], [record('1', '1990')]),
    ).toMatchObject({ total: 1, completed: 0, partial: 1, coverage: 0, years: [], genres: [] });
  });
  it('以 ID 去重，同名不同 ID 分别统计，部分、孤立记录与不一致 isHeard 不冒充完成', () => {
    const works = [work('1'), work('1'), work('2'), work('3'), work('4')];
    const rows = [
      progress('1'),
      progress('2'),
      { ...progress('3', 'partial'), isHeard: true },
      progress('missing'),
    ];
    expect(calculate(composers, works, rows, [record('4', '1990')])).toMatchObject({
      total: 4,
      completed: 2,
      partial: 1,
      coverage: 0.5,
      composerCount: 1,
      unknownDateCount: 2,
    });
  });
  it('沿用作品统计规则，容器、乐章、残篇、存疑、佚失与不可演奏作品不计数', () => {
    const works = [
      work('collection', { kind: 'collection', countPolicy: 'container' }),
      work('child', { parentWorkId: 'collection' }),
      work('movement', { kind: 'movement', countPolicy: 'noncountable' }),
      ...(['lost', 'fragment', 'doubtful'] as const).map((catalogStatus) =>
        work(catalogStatus, { catalogStatus }),
      ),
      work('silent', { isPerformable: false }),
    ];
    expect(
      calculate(
        composers,
        works,
        works.map((row) => progress(row.id)),
        [],
      ),
    ).toMatchObject({ total: 1, completed: 1, composerCount: 1 });
  });
  it('最早历史日期按作品归年，重复聆听、不同日期精度和创建时间不增计', () => {
    const works = ['1', '2', '3', '4'].map((id) => work(id));
    const records = [
      record('1', '2005-04-01', 'day'),
      record('1', '1980-12', 'month'),
      record('1', '1980'),
      record('2', '1980'),
      record('3', null, 'unknown'),
    ];
    expect(
      calculate(
        composers,
        works,
        works.map((row) => progress(row.id)),
        records,
      ),
    ).toMatchObject({ completed: 4, years: [{ year: 1980, count: 2 }], unknownDateCount: 2 });
  });
  it('日期不详与已知日期并存时采用最早已知年份，坏日期不造成 NaN', () => {
    const records = [
      record('1', null, 'unknown'),
      record('1', '1991'),
      record('2', 'bad'),
      record('2', '2001-02-30', 'day'),
      record('3', null),
    ];
    expect(
      calculate(
        composers,
        ['1', '2', '3'].map((id) => work(id)),
        ['1', '2', '3'].map((id) => progress(id)),
        records,
      ),
    ).toMatchObject({ years: [{ year: 1991, count: 1 }], unknownDateCount: 2 });
  });
  it('体裁优先使用 primaryGenre，缺失归入未分类，绝不按标题猜测', () => {
    const works = [
      work('1', { genre: 'Orchestral', primaryGenre: 'Symphony' }),
      work('2', { genre: 'Chamber' }),
      work('3', { titleOriginal: 'Concerto', genre: ' ' }),
      work('4', { genre: 'Keyboard' }),
    ];
    const result = calculate(
      composers,
      works,
      works.map((row) => progress(row.id)),
      [],
    );
    expect(result.genres).toEqual(
      expect.arrayContaining(
        ['交响曲', '室内乐', '其他/未分类', '键盘独奏'].map((name) => ({
          name,
          count: 1,
          percentage: 0.25,
        })),
      ),
    );
    expect(result.genres.reduce((sum, row) => sum + row.count, 0)).toBe(result.completed);
  });
  it('作曲家数量与覆盖率仅来自完整听过的可统计作品', () => {
    const works = [work('1'), work('2'), work('3', { composerId: 'b' })];
    const result = calculate(composers, works, [progress('1'), progress('3', 'partial')], []);
    expect(result).toMatchObject({
      composerCount: 1,
      coverage: 1 / 3,
      composers: [{ id: 'a', total: 2, completed: 1, coverage: 0.5 }],
    });
  });
  it('前十排序可切换作品数和覆盖率，不修改原输入', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: `${index}`,
      name: `${index}`,
      total: 100,
      completed: index + 1,
      coverage: (index + 1) / 100,
    }));
    rows[0] = { id: '0', name: '0', total: 1, completed: 1, coverage: 1 };
    expect(topListeningComposers(rows, 'count')).toHaveLength(10);
    expect(topListeningComposers(rows, 'count')[0]!.id).toBe('11');
    expect(topListeningComposers(rows, 'coverage')[0]!.id).toBe('0');
    expect(rows[0]!.id).toBe('0');
  });
});
