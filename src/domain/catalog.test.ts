import { describe, expect, it } from 'vitest';
import { catalogSortKey, normalizeSearch } from './catalog';

describe('目录排序与搜索', () => {
  it.each([
    ['K', 'K.9', 'K.10'],
    ['K', 'K.10', 'K.10a'],
    ['K', 'K.626', 'K.Anh.1'],
    ['Op', 'Op.10 No.2', 'Op.10 No.10'],
    ['BWV', 'BWV 99', 'BWV 100'],
    ['Hob', 'Hob.II:10', 'Hob.IX:1'],
    ['D', 'D.9', 'D.10'],
    ['RV', 'RV 9', 'RV 10'],
    ['WoO', 'WoO 2', 'WoO 10'],
    ['Hess', 'Hess 9', 'Hess 10'],
  ])('%s 按目录意义排序', (system, first, second) => {
    expect(catalogSortKey(system!, first!) < catalogSortKey(system!, second!)).toBe(true);
  });
  it('未解析编号稳定回退并保留版本', () => {
    expect(catalogSortKey('K', '未编号')).toBe(catalogSortKey('K', '未编号'));
    expect(catalogSortKey('K', 'K.9', '1964')).not.toBe(catalogSortKey('K', 'K.9', '2024'));
  });
  it('目录符号、空格、变音和 KV 变体可规范化', () => {
    expect(normalizeSearch('K. 551')).toBe(normalizeSearch('K551'));
    expect(normalizeSearch('KV 551')).toBe('k551');
    expect(normalizeSearch('Frédéric')).toBe('frederic');
  });
});
