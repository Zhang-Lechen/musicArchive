import { describe, expect, it } from 'vitest';
import {
  formatDate,
  latestListeningDate,
  listeningDateKey,
  localToday,
  validateDate,
} from './dates';

describe('本地日历日期', () => {
  it.each([
    ['year', '2019', 'year:2019'],
    ['month', '2019-06', 'month:2019-06'],
    ['day', '2019-06-15', 'day:2019-06-15'],
    ['day', '2020-02-29', 'day:2020-02-29'],
    ['unknown', null, 'unknown'],
  ] as const)('合法日期 %s %s 保留精度并生成去重键', (precision, value, key) => {
    expect(() => validateDate(precision, value, '2026-01-01')).not.toThrow();
    expect(listeningDateKey(precision, value)).toBe(key);
  });
  it.each([
    ['year', '2027'],
    ['month', '2026-02'],
    ['day', '2026-01-02'],
    ['day', '2019-02-29'],
    ['day', '2019-6-15'],
    ['month', '2019-06-01'],
  ] as const)('按注入的本地今天拒绝未来值或错误格式 %s %s', (precision, value) => {
    expect(() => validateDate(precision, value, '2026-01-01')).toThrow();
  });
  it('最近聆听日期按实际日期比较，忽略不详并保留已有精度，不改变原始记录顺序', () => {
    const records = [
      { datePrecision: 'year', dateValue: '2020' },
      { datePrecision: 'day', dateValue: '2020-06-15' },
      { datePrecision: 'month', dateValue: '2020-06' },
      { datePrecision: 'unknown', dateValue: null },
      { datePrecision: 'day', dateValue: '2019-12-31' },
    ] as const;
    expect(latestListeningDate(records)).toBe(records[1]);
    expect(records[0].dateValue).toBe('2020');
    expect(latestListeningDate([...records, { datePrecision: 'year', dateValue: '2021' }])).toEqual(
      { datePrecision: 'year', dateValue: '2021' },
    );
    expect(latestListeningDate([{ datePrecision: 'unknown', dateValue: null }])).toBeUndefined();
    expect(latestListeningDate([])).toBeUndefined();
  });
  it('保留年、月、日、不详四种精度', () => {
    expect(formatDate('year', '2019')).toBe('2019年');
    expect(formatDate('month', '2019-06')).toBe('2019年6月');
    expect(formatDate('day', '2019-06-15')).toBe('2019年6月15日');
    expect(formatDate('unknown', null)).toBe('日期不详');
  });
  it.each([
    ['day', '2023-02-29'],
    ['day', '2019-04-31'],
    ['month', '2019-13'],
    ['year', '0000'],
    ['year', '9999'],
    ['year', '2019-01-01'],
    ['unknown', '2019'],
  ] as const)('拒绝非法或未来日期 %s %s', (precision, value) => {
    expect(() => validateDate(precision, value, '2026-11-04')).toThrow();
  });
  it('不经过 UTC 解析，支持闰年和历史年', () => {
    expect(() => validateDate('day', '2000-02-29', '2026-11-04')).not.toThrow();
    expect(() => validateDate('day', '1900-02-29', '2026-11-04')).toThrow();
    expect(localToday(new Date(2026, 0, 1, 0, 1))).toBe('2026-01-01');
  });
});
