import { useId } from 'react';
import { primaryIdentifier } from '../domain/catalog';
import { formatDate, latestListeningDate } from '../domain/dates';
import type { WorkView } from '../domain/types';
import { WorkPreferenceActions } from './PreferenceActions';

export function WorkCard({
  work,
  selected,
  onSelect,
  onOpen,
  onListen,
  onMarkHeard,
  busy,
  childCount = 0,
}: {
  work: WorkView;
  selected?: boolean;
  onSelect?: () => void;
  onOpen: () => void;
  onListen: () => void;
  onMarkHeard: () => void;
  busy: boolean;
  childCount?: number;
}) {
  const heard = Boolean(work.progress?.isHeard);
  const latest = heard ? latestListeningDate(work.records) : undefined;
  const latestDateId = useId();
  const playable = work.catalogStatus !== 'lost' && work.kind === 'work' && !work.parentWorkId;
  return (
    <article className={`work-card ${heard ? 'work-heard' : ''}`} data-testid="work-card">
      {playable && onSelect && (
        <input
          className="work-checkbox"
          type="checkbox"
          aria-label={`选择 ${primaryIdentifier(work)?.value ?? work.titleOriginal}`}
          checked={selected}
          onChange={onSelect}
        />
      )}
      <button
        className="work-main"
        onClick={onOpen}
        aria-label={`查看 ${primaryIdentifier(work)?.value ?? '未编号'} ${work.titleZh ?? work.titleOriginal}`}
        aria-describedby={heard ? latestDateId : undefined}
      >
        <span className="catalog-number">{primaryIdentifier(work)?.value ?? '未编号'}</span>
        <h2>{work.titleZh ?? work.titleOriginal}</h2>
        {work.titleZh && (
          <span className="work-original" lang="en">
            {work.titleOriginal}
          </span>
        )}
        <span className="work-meta">
          {[
            work.genre,
            work.key,
            work.catalogStatus === 'doubtful'
              ? '归属存疑'
              : work.catalogStatus === 'lost'
                ? '佚失，不计进度'
                : work.catalogStatus === 'fragment'
                  ? '片段 / 未完成'
                  : '',
            work.kind === 'collection' ? '作品集，不计进度' : '',
            work.parentWorkId ? '子作品，不单独统计' : '',
            childCount ? `含 ${childCount} 条子作品，不推断聆听状态` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {heard && (
          <span className="latest-listening-date" id={latestDateId}>
            最近聆听日期：
            {latest ? (
              <time dateTime={latest.dateValue ?? undefined}>
                {formatDate(latest.datePrecision, latest.dateValue)}
              </time>
            ) : (
              '日期不详'
            )}
          </span>
        )}
      </button>
      <div className="work-actions">
        <span className={`badge ${heard ? 'badge-heard' : ''}`}>
          {heard ? '✓ 已听过' : '○ 未听过'}
        </span>
        {playable && (
          <div className="work-listen-buttons">
            {!heard && (
              <button
                className="heard-button"
                disabled={busy}
                onClick={onMarkHeard}
                title="标记已听过（日期不详）"
              >
                听过
              </button>
            )}
            <button
              className={heard ? 'secondary-button' : 'primary-button'}
              disabled={busy}
              onClick={onListen}
            >
              {busy ? '保存中…' : heard ? '记录日期' : '聆听'}
            </button>
          </div>
        )}
      </div>
      <div className="work-preferences">
        <WorkPreferenceActions
          workId={work.id}
          name={primaryIdentifier(work)?.value ?? work.titleZh ?? work.titleOriginal}
        />
      </div>
    </article>
  );
}
