import { isCountable, type ListeningStatus, type Work, type WorkProgress } from './types';

export const isEligibleWork = isCountable;

export function countCompletedUniqueWorks(
  works: readonly Work[],
  progressByWorkId: ReadonlyMap<string, ListeningStatus | WorkProgress>,
): number {
  const completed = new Set<string>();
  for (const work of works) {
    const progress = progressByWorkId.get(work.id);
    const status = typeof progress === 'string' ? progress : progress?.status;
    if (isEligibleWork(work) && status === 'completed') completed.add(work.id);
  }
  return completed.size;
}
