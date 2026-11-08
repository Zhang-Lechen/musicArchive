import { describe, expect, it } from 'vitest';
import { countCompletedUniqueWorks, isEligibleWork } from './counting';
import type { Work } from './types';

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id,
    composerId: 'test-composer',
    titleOriginal: id,
    kind: 'work',
    nodeType: 'standalone',
    countPolicy: 'countable',
    isPerformable: true,
    catalogStatus: 'confirmed',
    ...overrides,
  };
}
describe('独立作品统计口径', () => {
  it('贝九整部 partial 计 0、completed 计 1，乐章和重复 ID 不增计', () => {
    const ninth = work('ninth');
    const movement = work('movement', {
      parentWorkId: ninth.id,
      kind: 'movement',
      nodeType: 'movement',
      countPolicy: 'noncountable',
    });
    expect(
      countCompletedUniqueWorks(
        [ninth, movement],
        new Map([
          ['ninth', 'partial'],
          ['movement', 'completed'],
        ]),
      ),
    ).toBe(0);
    expect(
      countCompletedUniqueWorks(
        [ninth, ninth, movement],
        new Map([
          ['ninth', 'completed'],
          ['movement', 'completed'],
        ]),
      ),
    ).toBe(1);
  });
  it('Op.28 容器计 0，可独立前奏曲完成三首计 3，无需日期', () => {
    const collection = work('op28', {
      kind: 'collection',
      nodeType: 'collection',
      countPolicy: 'container',
    });
    const preludes = [1, 2, 3, 4].map((id) => work(`prelude-${id}`, { parentWorkId: 'op28' }));
    expect(
      countCompletedUniqueWorks(
        [collection, ...preludes],
        new Map([
          ['op28', 'completed'],
          ['prelude-1', 'completed'],
          ['prelude-2', 'completed'],
          ['prelude-3', 'completed'],
          ['prelude-4', 'partial'],
        ]),
      ),
    ).toBe(3);
  });
  it('不按叶节点猜测资格，存疑、残篇、佚失、不可演奏及未完成作品不计入', () => {
    for (const catalogStatus of ['lost', 'doubtful', 'fragment'] as const)
      expect(isEligibleWork(work(catalogStatus, { catalogStatus }))).toBe(false);
    expect(isEligibleWork(work('silent', { isPerformable: false }))).toBe(false);
    expect(isEligibleWork(work('leaf', { countPolicy: 'noncountable' }))).toBe(false);
    expect(countCompletedUniqueWorks([work('missing')], new Map())).toBe(0);
  });
});
