import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { repository } from '../../db/repository';
import { composerMatches } from '../../domain/catalog';
import { useDebounced } from '../../components/use-debounced';

import { ComposerCard } from '../../components/ComposerCard';
import { eraLabels } from '../../domain/labels';
const featured = ['Mozart', 'Beethoven', 'Bach', 'Haydn', 'Schubert', 'Vivaldi', 'Chopin'];
export function HomePage() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const search = useDebounced(query, 250);
  const [era, setEra] = useState('');
  const [personal, setPersonal] = useState('all');
  const [cursor, setCursor] = useState({ key: '', page: 1 });
  const composers = useLiveQuery(() => repository.composerSummaries(), []);
  const filtered = useMemo(() => {
    return (composers ?? [])
      .filter(
        (c) =>
          (!era || c.era === era) &&
          (personal === 'all' ||
            (personal === 'following' ? c.preference?.isFollowing : c.preference?.isFavorite)) &&
          composerMatches(c, search),
      )
      .sort((a, b) => {
        const rank = (aliases: string[]) => {
          const index = featured.findIndex((name) => aliases.includes(name));
          return index < 0 ? 99 : index;
        };
        return rank(a.aliases) - rank(b.aliases) || a.nameOriginal.localeCompare(b.nameOriginal);
      });
  }, [composers, era, search, personal]);
  const key = `${query}|${era}|${personal}`;
  const pages = Math.max(1, Math.ceil(filtered.length / 24));
  const page = Math.min(cursor.key === key ? cursor.page : 1, pages);
  const total = composers?.reduce((sum, c) => sum + c.total, 0) ?? 0;
  const heard = composers?.reduce((sum, c) => sum + c.heard, 0) ?? 0;
  return (
    <section aria-labelledby="home-title">
      <div className="hero">
        <div>
          <p className="eyebrow">你的私人聆听书房</p>
          <h1 id="home-title">让每一次聆听，都有迹可循。</h1>
          <p className="page-intro">从熟悉的作曲家出发，慢慢走进下一部作品。</p>
        </div>
        <Link
          className="hero-stat"
          to="/statistics"
          aria-label={`${heard.toLocaleString()} 部作品已听过，查看聆听统计`}
        >
          <span className="hero-stat-number">{heard.toLocaleString()}</span>
          <span>部作品已听过</span>
          <span className="muted small">在已收录的 {total.toLocaleString()} 部可统计作品中</span>
          <span className="hero-stat-hint">查看聆听统计 →</span>
        </Link>
      </div>
      <div className="section-heading">
        <div>
          <p className="eyebrow">COMPOSERS</p>
          <h2>作曲家</h2>
        </div>
        <p className="muted">{composers?.length ?? '…'} 位已收录 · 目录持续完善</p>
      </div>
      <div className="toolbar">
        <label>
          个人标记
          <select value={personal} onChange={(event) => setPersonal(event.target.value)}>
            <option value="all">全部作曲家</option>
            <option value="following">已关注</option>
            <option value="favorite">已喜欢</option>
          </select>
        </label>
        <label>
          音乐时期
          <select value={era} onChange={(event) => setEra(event.target.value)}>
            <option value="">全部时期</option>
            {[
              ...new Set(
                (composers ?? []).map((c) => c.era).filter((era): era is string => Boolean(era)),
              ),
            ].map((era) => (
              <option key={era} value={era}>
                {eraLabels[era] ?? era}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {query ? `“${query}” · ` : ''}
          {filtered.length} 位作曲家
        </p>
        {query && <Link to="/">清除搜索</Link>}
      </div>
      {!composers ? (
        <p role="status" className="empty-state">
          正在读取本地目录…
        </p>
      ) : !filtered.length ? (
        <div className="empty-state">
          <h3>{composers.length ? '没有找到匹配的作曲家' : '目录待完善'}</h3>
          <p>尝试中文名、原文名，或更换时期与个人标记筛选。可从“数据与备份”导入目录。</p>
        </div>
      ) : (
        <div className="composer-grid">
          {filtered.slice((page - 1) * 24, page * 24).map((composer, index) => (
            <ComposerCard
              key={composer.id}
              composer={composer}
              index={(page - 1) * 24 + index + 1}
              progress={composer}
            />
          ))}
        </div>
      )}
      {pages > 1 && (
        <nav className="pagination" aria-label="作曲家分页">
          <button disabled={page === 1} onClick={() => setCursor({ key, page: page - 1 })}>
            上一页
          </button>
          <span>
            第 {page} / {pages} 页
          </span>
          <button disabled={page === pages} onClick={() => setCursor({ key, page: page + 1 })}>
            下一页
          </button>
        </nav>
      )}
      <p className="archive-note">
        进度仅针对当前收录、可统计的独立作品。目录数量不代表作曲家的全部创作，作品集与乐章不自动计入。
      </p>
    </section>
  );
}
