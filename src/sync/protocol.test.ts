import { describe, expect, it } from 'vitest';
import { merge, payloadSchema, type Payload } from './protocol';
const base: Payload = {
  kind: 'work',
  title: 'Work',
  status: 'completed',
  favorite: false,
  following: false,
  queued: false,
  records: {},
};
describe('同步领域合并', () => {
  it('独立日期与不同偏好字段合并', () => {
    const left = {
      ...base,
      favorite: true,
      records: { a: { datePrecision: 'year' as const, dateValue: '2019' } },
    };
    const right = {
      ...base,
      queued: true,
      records: { b: { datePrecision: 'unknown' as const, dateValue: null } },
    };
    const result = merge(base, left, right);
    expect(result.conflict).toBe(false);
    expect(result.payload).toMatchObject({
      favorite: true,
      queued: true,
      records: { ...left.records, ...right.records },
    });
  });
  it('日期并发修改、删除/修改、状态降级/新增日期均冲突', () => {
    const initial = {
      ...base,
      records: { a: { datePrecision: 'year' as const, dateValue: '2019' } },
    };
    const edited = {
      ...base,
      records: { a: { datePrecision: 'year' as const, dateValue: '2020' } },
    };
    expect(merge(initial, base, edited).conflict).toBe(true);
    expect(merge(initial, null, edited).conflict).toBe(true);
    expect(merge(base, { ...base, status: 'partial' }, edited).conflict).toBe(true);
  });
  it('不同事件 ID 的同日记录不能静默丢弃', () => {
    const date = { datePrecision: 'year' as const, dateValue: '2019' };
    expect(
      merge(base, { ...base, records: { a: date } }, { ...base, records: { b: date } }).conflict,
    ).toBe(true);
  });
  it('拒绝未知字段、非法日期和不一致状态', () => {
    expect(payloadSchema.safeParse({ ...base, futureField: true }).success).toBe(false);
    expect(
      payloadSchema.safeParse({
        ...base,
        records: { a: { datePrecision: 'day', dateValue: '2023-02-29' } },
      }).success,
    ).toBe(false);
    expect(
      payloadSchema.safeParse({
        ...base,
        status: 'partial',
        records: { a: { datePrecision: 'unknown', dateValue: null } },
      }).success,
    ).toBe(false);
  });
});
