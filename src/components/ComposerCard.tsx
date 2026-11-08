import { Link } from 'react-router-dom';
import type { Composer } from '../domain/types';
import { eraLabels } from '../domain/labels';
import { ComposerPreferenceActions } from './PreferenceActions';

export function ComposerCard({
  composer,
  index,
  progress,
}: {
  composer: Composer;
  index: number;
  progress?: { heard: number; total: number };
}) {
  const name = composer.nameZh ?? composer.nameOriginal;
  return (
    <article className="composer-card">
      <Link to={`/composers/${composer.id}`} className="composer-card-link">
        <div className="composer-card-top">
          <span className="composer-index" aria-hidden="true">
            {String(index).padStart(2, '0')}
          </span>
          <span className="small muted">
            {eraLabels[composer.era ?? ''] ?? composer.era ?? '时期未详'}
          </span>
        </div>
        <h3>{name}</h3>
        <p className="composer-original" lang="en">
          {composer.nameOriginal}
        </p>
        <p className="muted small">
          {composer.birthYear ?? '生年未详'} — {composer.deathYear ?? '—'}
          {composer.primaryCatalog ? ` · ${composer.primaryCatalog}` : ''}
        </p>
        {progress && (
          <div className="composer-progress">
            <strong>
              {progress.heard} <span>/ {progress.total}</span>
            </strong>
            <span className="small">已听过 / 可统计作品</span>
            <progress
              aria-label={`${name} 已收录作品中的进度`}
              value={progress.heard}
              max={progress.total || 1}
            />
          </div>
        )}
        <p className="coverage-note">
          {composer.coverageStatus === 'verified'
            ? '目录已核实'
            : composer.coverageStatus === 'sample'
              ? '示例目录 · 完整性未验证'
              : '部分目录 · 完整性未验证'}
          <span aria-hidden="true">↗</span>
        </p>
      </Link>
      <ComposerPreferenceActions composerId={composer.id} name={name} />
    </article>
  );
}
