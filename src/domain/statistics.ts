import { isEligibleWork } from './counting';
import { validateDate } from './dates';
import type { Composer, ListeningRecord, Work, WorkProgress } from './types';

const genreLabels: Record<string, string> = {
  orchestral: '管弦乐',
  chamber: '室内乐',
  keyboard: '键盘独奏',
  stage: '舞台作品',
  vocal: '声乐',
  symphony: '交响曲',
  concerto: '协奏曲',
  solo: '独奏',
  opera: '歌剧',
};

export type ComposerListeningSummary = {
  id: string;
  name: string;
  total: number;
  completed: number;
  coverage: number;
};

/** Read-only projection. Status is authoritative; dates never imply completion. */
export function calculateListeningStatistics(
  composers: readonly Composer[],
  works: readonly Work[],
  progress: readonly WorkProgress[],
  records: readonly ListeningRecord[],
) {
  const byStatus = new Map(progress.map((row) => [row.workId, row.status]));
  const eligible = new Map(works.filter(isEligibleWork).map((work) => [work.id, work]));
  const completed = new Map([...eligible].filter(([id]) => byStatus.get(id) === 'completed'));
  const partial = [...eligible.keys()].filter((id) => byStatus.get(id) === 'partial').length;
  const totals = new Map<string, number>();
  const heard = new Map<string, number>();
  const genres = new Map<string, number>();
  for (const work of eligible.values())
    totals.set(work.composerId, (totals.get(work.composerId) ?? 0) + 1);
  for (const work of completed.values()) {
    heard.set(work.composerId, (heard.get(work.composerId) ?? 0) + 1);
    const rawGenre = work.primaryGenre?.trim() || work.genre?.trim();
    const genre = rawGenre ? (genreLabels[rawGenre.toLowerCase()] ?? rawGenre) : '其他/未分类';
    genres.set(genre, (genres.get(genre) ?? 0) + 1);
  }
  // Only use the entered historical date. Never fall back to createdAt/updatedAt.
  // Unknown dates coexist with known ones; use the earliest known completion year.
  const firstYear = new Map<string, number>();
  for (const record of records) {
    if (!completed.has(record.workId) || record.datePrecision === 'unknown') continue;
    try {
      validateDate(record.datePrecision, record.dateValue, '9999-12-31');
    } catch {
      continue;
    }
    const year = Number(record.dateValue!.slice(0, 4));
    firstYear.set(record.workId, Math.min(firstYear.get(record.workId) ?? year, year));
  }
  const years = new Map<number, number>();
  for (const year of firstYear.values()) years.set(year, (years.get(year) ?? 0) + 1);
  const names = new Map(
    composers.map((composer) => [composer.id, composer.nameZh ?? composer.nameOriginal]),
  );
  return {
    total: eligible.size,
    completed: completed.size,
    partial,
    composerCount: heard.size,
    coverage: eligible.size ? completed.size / eligible.size : 0,
    composers: [...heard].map(([id, count]): ComposerListeningSummary => ({
      id,
      name: names.get(id) ?? '未命名作曲家',
      total: totals.get(id) ?? 0,
      completed: count,
      coverage: count / totals.get(id)!,
    })),
    genres: [...genres]
      .map(([name, count]) => ({ name, count, percentage: count / completed.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    years: [...years].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
    unknownDateCount: completed.size - firstYear.size,
  };
}

export function topListeningComposers(
  rows: readonly ComposerListeningSummary[],
  sort: 'count' | 'coverage',
) {
  return [...rows]
    .sort(
      (a, b) =>
        (sort === 'coverage' ? b.coverage - a.coverage : b.completed - a.completed) ||
        b.completed - a.completed ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 10);
}
