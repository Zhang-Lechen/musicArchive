// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractIdentifiers, normalizeSnapshot } from './catalog-core';

const snapshot = {
  retrievedAt: '2026-11-03T16:00:00.000Z',
  license: 'CC0-1.0',
  composers: [
    {
      id: '196',
      name: 'Mozart',
      complete_name: 'Wolfgang Amadeus Mozart',
      birth: '1756-01-01',
      death: '1791-01-01',
      epoch: 'Classical',
      works: [
        {
          id: '1',
          title: 'Symphony no. 41 in C major, K.551, "Jupiter"',
          subtitle: '',
          genre: 'Orchestral',
          searchterms: '',
        },
        { id: '2', title: 'Unnumbered work', subtitle: '', genre: 'Chamber', searchterms: '' },
      ],
    },
  ],
};
describe('可重放的离线目录规范化', () => {
  it('真实来源 ID 映射为稳定内部 ID，重复运行结果一致', () => {
    const first = normalizeSnapshot(snapshot),
      second = normalizeSnapshot(snapshot);
    expect(first).toEqual(second);
    expect(first.catalog.works[0]?.id).not.toBe('1');
    expect(first.catalog.sourceMappings.find((m) => m.sourceId === '1')?.internalId).toBe(
      first.catalog.works[0]?.id,
    );
    expect(first.catalog.composers[0]?.coverageStatus).toBe('partial');
    expect(first.reviews.some((r) => r.reason.includes('缺少'))).toBe(true);
    expect(first.catalog.workAliases.some((a) => a.text === 'Jupiter')).toBe(true);
  });
  it('缺名拒绝处理，不用数字冒充名称，重复来源产生复核记录', () => {
    const corrupt = structuredClone(snapshot);
    corrupt.composers[0]!.works[0]!.title = '';
    expect(() => normalizeSnapshot(corrupt)).toThrow();
    const duplicate = structuredClone(snapshot);
    duplicate.composers[0]!.works.push(duplicate.composers[0]!.works[0]!);
    const result = normalizeSnapshot(duplicate);
    expect(result.catalog.works).toHaveLength(2);
    expect(result.reviews.some((r) => r.reason.includes('重复来源'))).toBe(true);
  });
  it('保留多编号、罗马分组、子号及补遗，复杂范围需复核', () => {
    expect(extractIdentifiers('Concerto, RV.269, op. 8, no. 1')).toEqual([
      { system: 'RV', value: 'RV. 269' },
      { system: 'Op', value: 'Op. 8, no. 1' },
    ]);
    expect(extractIdentifiers('Symphony, Hob.I:94')[0]?.value).toBe('Hob. I:94');
    expect(extractIdentifiers('Piece, K.Anh.1')[0]?.value).toBe('K. Anh.1');
  });
});
