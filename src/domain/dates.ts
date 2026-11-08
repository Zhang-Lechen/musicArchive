import type { DatePrecision, ListeningRecord } from './types';

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function validateDate(precision: DatePrecision, value: string | null, today = localToday()) {
  if (precision === 'unknown') {
    if (value !== null) throw new Error('日期不详时不得保存具体日期。');
    return;
  }
  const patterns = { year: /^\d{4}$/, month: /^\d{4}-\d{2}$/, day: /^\d{4}-\d{2}-\d{2}$/ };
  if (!value || !Object.hasOwn(patterns, precision) || !patterns[precision].test(value))
    throw new Error('日期格式不正确，请按所选精度填写。');
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) throw new Error('请输入有效的日历日期。');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > (days[month - 1] ?? 0)) throw new Error('请输入有效的日历日期。');
  if (value > today.slice(0, value.length)) throw new Error('聆听日期不能晚于今天。');
}

export function listeningDateKey(precision: DatePrecision, value: string | null): string {
  return precision === 'unknown' ? 'unknown' : `${precision}:${value}`;
}

export function formatDate(precision: DatePrecision, value: string | null) {
  if (precision === 'unknown' || !value) return '日期不详';
  const [year, month, day] = value.split('-');
  return `${year}年${month ? `${Number(month)}月` : ''}${day ? `${Number(day)}日` : ''}`;
}

type ListeningDate = Pick<ListeningRecord, 'datePrecision' | 'dateValue'>;

export function latestListeningDate(records: readonly ListeningDate[]): ListeningDate | undefined {
  let latest: ListeningDate | undefined;
  for (const record of records) {
    if (record.datePrecision === 'unknown' || !record.dateValue) continue;
    if (!latest || record.dateValue > (latest.dateValue ?? '')) latest = record;
  }
  return latest;
}
