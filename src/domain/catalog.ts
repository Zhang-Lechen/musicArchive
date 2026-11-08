import type { Composer, WorkIdentifier, WorkView } from './types';

export function composerMatches(composer: Composer, query: string) {
  const needle = normalizeSearch(query);
  return [composer.nameOriginal, composer.nameZh ?? '', ...composer.aliases].some((name) =>
    normalizeSearch(name).includes(needle),
  );
}

export function normalizeSearch(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/^kv(?=\d)/, 'k');
}

const canonicalSystems: Record<string, string> = {
  kv: 'K',
  k: 'K',
  op: 'Op',
  woo: 'WoO',
  hess: 'Hess',
  bwv: 'BWV',
  hob: 'Hob',
  d: 'D',
  rv: 'RV',
};
const roman: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function romanValue(text: string) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    const n = roman[text[i] ?? ''] ?? 0;
    sum += n < (roman[text[i + 1] ?? ''] ?? 0) ? -n : n;
  }
  return sum;
}
export function canonicalSystem(system: string) {
  return canonicalSystems[normalizeSearch(system)] ?? system.trim();
}

// System, appendix group, main number, suffix, subnumber; unknown values sort stably last.
export function catalogSortKey(system: string, value: string, edition = '') {
  const canonical = canonicalSystem(system);
  let body = value
    .normalize('NFKC')
    .trim()
    .replace(/^(?:KV?|Op|WoO|Hess|BWV|Hob|D|RV)\.?\s*/i, '');
  const appendix = /^(?:Anh|App|Anhang)\.?\s*/i.test(body);
  body = body.replace(/^(?:Anh|App|Anhang)\.?\s*/i, '');
  if (canonical === 'Hob')
    body = body.replace(
      /^([IVXLC]+)\s*:/i,
      (_, group: string) => `${romanValue(group.toUpperCase())}:`,
    );
  const parsed =
    body.match(/^(\d+)([a-z]?)(?:\s*[:/.]\s*|\s*,?\s*(?:no\.?|nr\.?)\s*)(\d+)([a-z]?)\b/i) ??
    body.match(/^(\d+)([a-z]?)(?:$|\s|,)/i);
  if (!parsed) return `${canonical}|9|${normalizeSearch(body)}|${edition}`;
  return `${canonical}|${appendix ? 1 : 0}|${String(parsed[1]).padStart(10, '0')}|${(parsed[2] || '0').toLowerCase()}|${String(parsed[3] ?? '0').padStart(6, '0')}|${(parsed[4] || '0').toLowerCase()}|${edition}`;
}

export function makeIdentifier(
  workId: string,
  system: string,
  value: string,
  isPrimary = true,
  edition?: string,
): WorkIdentifier {
  return {
    id: crypto.randomUUID(),
    workId,
    system: canonicalSystem(system),
    value: value.trim(),
    normalizedValue: normalizeSearch(value),
    sortKey: catalogSortKey(system, value, edition),
    isPrimary,
    edition,
  };
}
export function primaryIdentifier(work: Pick<WorkView, 'identifiers'>) {
  return work.identifiers.find((identifier) => identifier.isPrimary) ?? work.identifiers[0];
}
export function workMatches(work: WorkView, query: string) {
  const needle = normalizeSearch(query);
  return (
    !needle ||
    [
      work.titleOriginal,
      work.titleZh ?? '',
      ...work.aliases.map((alias) => alias.text),
      ...work.identifiers.map((id) => id.value),
    ].some((text) => normalizeSearch(text).includes(needle))
  );
}
export function compareWorks(a: WorkView, b: WorkView, byName = false) {
  if (byName)
    return (
      (a.titleZh ?? a.titleOriginal).localeCompare(b.titleZh ?? b.titleOriginal, 'zh-CN') ||
      a.id.localeCompare(b.id)
    );
  const firstId = primaryIdentifier(a),
    secondId = primaryIdentifier(b);
  const systemOrder = ['K', 'BWV', 'Op', 'WoO', 'Hess', 'Hob', 'D', 'RV'];
  if (firstId && secondId && firstId.system !== secondId.system) {
    const rank = (system: string) => {
      const index = systemOrder.indexOf(system);
      return index < 0 ? 99 : index;
    };
    const difference = rank(firstId.system) - rank(secondId.system);
    if (difference) return difference;
  }
  const first = firstId?.sortKey ?? 'zz|9';
  const second = secondId?.sortKey ?? 'zz|9';
  return first < second ? -1 : first > second ? 1 : a.id.localeCompare(b.id);
}
