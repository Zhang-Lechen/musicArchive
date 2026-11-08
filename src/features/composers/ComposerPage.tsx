import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { repository } from '../../db/repository';
import { compareWorks, workMatches } from '../../domain/catalog';
import { isCountable } from '../../domain/types';
import { WorkCard } from '../../components/WorkCard';
import { ListeningDialog } from '../listening/ListeningDialog';
import { ManualWorkDialog } from '../works/ManualWorkDialog';
import { useArchive } from '../../app/archive-context';
import { useDebounced } from '../../components/use-debounced';
import { eraLabels } from '../../domain/labels';
import { ComposerPreferenceActions } from '../../components/PreferenceActions';

export function ComposerPage() {
  const { composerId = '' } = useParams<{ composerId: string }>();
  return <ComposerDetail key={composerId} composerId={composerId} />;
}
function ComposerDetail({ composerId }: { composerId: string }) {
  const composer = useLiveQuery(
    async () => (await repository.getComposer(composerId)) ?? null,
    [composerId],
  );
  const works = useLiveQuery(() => repository.listWorks(composerId), [composerId]);
  const [query, setQuery] = useState('');
  const search = useDebounced(query);
  const [status, setStatus] = useState('all');
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState('catalog');
  const [showChildren, setShowChildren] = useState(false);
  const [cursor, setCursor] = useState({ key: '', page: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string>();
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notify } = useArchive();
  const countable = (works ?? []).filter(isCountable);
  const heard = countable.filter((work) => work.progress?.isHeard).length;
  const filtered = useMemo(
    () =>
      (works ?? [])
        .filter(
          (work) =>
            (showChildren || !work.parentWorkId) &&
            (!genre || work.genre === genre) &&
            (status === 'all' || Boolean(work.progress?.isHeard) === (status === 'heard')) &&
            workMatches(work, search),
        )
        .sort((a, b) => compareWorks(a, b, sort === 'name')),
    [works, showChildren, genre, status, search, sort],
  );
  const key = JSON.stringify([search, status, genre, sort, showChildren]);
  const pages = Math.max(1, Math.ceil(filtered.length / 36));
  const page = Math.min(cursor.key === key ? cursor.page : 1, pages);
  const visible = filtered.slice((page - 1) * 36, page * 36);
  const selectable = visible.filter(isCountable);
  const active = works?.find((w) => w.id === activeId);
  const children = new Map<string, number>();
  for (const work of works ?? [])
    if (work.parentWorkId)
      children.set(work.parentWorkId, (children.get(work.parentWorkId) ?? 0) + 1);
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function mark(ids: string[], today: boolean) {
    setBusy(true);
    setError('');
    try {
      const token = await repository.setHeard(ids, today);
      notify(`已记录 ${ids.length} 部作品${today ? '，日期为今天' : '，日期不详'}。`, token);
      setSelected(new Set());
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function markHeard(workId: string) {
    setBusy(true);
    setError('');
    try {
      const token = await repository.setStatus(workId, 'completed', {
        completedDate: { datePrecision: 'unknown', dateValue: null },
      });
      notify('已标记听过，日期不详。', token);
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  if (composer === undefined || works === undefined) return <p role="status">正在读取作品目录…</p>;
  if (!composer)
    return (
      <section>
        <h1>未找到作曲家</h1>
        <p className="page-intro">目录可能已更新，或此地址不属于当前档案。</p>
        <Link className="back-link" to="/">
          返回首页
        </Link>
      </section>
    );
  return (
    <section aria-labelledby="composer-title">
      <Link className="back-link" to="/">
        ← 全部作曲家
      </Link>
      <div className="detail-hero">
        <div>
          <p className="eyebrow">{eraLabels[composer.era ?? ''] ?? composer.era ?? '作曲家'}</p>
          <h1 id="composer-title">{composer.nameZh ?? composer.nameOriginal}</h1>
          <ComposerPreferenceActions
            composerId={composer.id}
            name={composer.nameZh ?? composer.nameOriginal}
          />
          <p className="composer-detail-original" lang="en">
            {composer.nameOriginal}
          </p>
          <p className="muted">
            {composer.birthYear ?? '生年未详'} — {composer.deathYear ?? '—'}
            {composer.primaryCatalog ? ` · ${composer.primaryCatalog}` : ''}
          </p>
        </div>
        <div className="detail-progress">
          <strong>
            {heard}
            <span> / {countable.length}</span>
          </strong>
          <span>已听过 / 已收录可统计作品</span>
          <progress aria-label="已收录作品中的进度" value={heard} max={countable.length || 1} />
        </div>
      </div>
      <div className="coverage-banner">
        <span>
          {composer.coverageStatus === 'verified'
            ? '目录已核实'
            : `已收录 ${works.length} 条；目录完整性未验证`}
        </span>
        <span>
          {composer.source?.name ?? '本地目录'} ·{' '}
          {composer.source?.catalogEdition ?? '目录版次未注明'}
        </span>
      </div>
      <div className="catalog-toolbar">
        <label className="work-search">
          搜索作品
          <input
            type="search"
            placeholder="编号、名称或别名，如 K551、朱庇特"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          听过状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">全部</option>
            <option value="heard">已听过</option>
            <option value="unheard">未听过</option>
          </select>
        </label>
        <label>
          体裁
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">全部体裁</option>
            {[
              ...new Set(
                works.map((w) => w.genre).filter((genre): genre is string => Boolean(genre)),
              ),
            ].map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </label>
        <label>
          排序
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="catalog">主编号升序</option>
            <option value="name">作品名称</option>
          </select>
        </label>
      </div>
      <div className="catalog-controls">
        <label className="check-label">
          <input
            type="checkbox"
            checked={showChildren}
            onChange={(e) => setShowChildren(e.target.checked)}
          />
          显示子作品（不单独计进度）
        </label>
        <button onClick={() => setManual(true)} disabled={busy}>
          ＋ 补录作品
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="results-bar">
        <label className="check-label">
          <input
            type="checkbox"
            disabled={!selectable.length || busy}
            checked={selectable.length > 0 && selectable.every((w) => selected.has(w.id))}
            onChange={(e) =>
              setSelected((current) => {
                const next = new Set(current);
                for (const w of selectable)
                  if (e.target.checked) next.add(w.id);
                  else next.delete(w.id);
                return next;
              })
            }
          />
          选择本页
        </label>
        <span className="muted" role="status">
          {filtered.length} 条匹配作品 · 每页最多 36 条
        </span>
      </div>
      {selected.size > 0 && (
        <div className="batch-bar">
          <strong>已选择 {selected.size} 部（可跨页）</strong>
          <div className="button-row">
            <button disabled={busy} onClick={() => void mark([...selected], true)}>
              批量记录今天
            </button>
            <button disabled={busy} onClick={() => void mark([...selected], false)}>
              批量标记日期不详
            </button>
            <button disabled={busy} onClick={() => setSelected(new Set())}>
              取消选择
            </button>
          </div>
        </div>
      )}
      {!filtered.length ? (
        <div className="empty-state">
          <h2>{works.length ? '没有匹配的作品' : '目录待完善'}</h2>
          <p>尝试其他编号、名称或筛选条件，也可以手动补录作品。</p>
          <button
            onClick={() => {
              setQuery('');
              setStatus('all');
              setGenre('');
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <div className="work-list">
          {visible.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              selected={selected.has(work.id)}
              onSelect={() => toggle(work.id)}
              onOpen={() => setActiveId(work.id)}
              onListen={() => {
                if (work.progress?.isHeard) setActiveId(work.id);
                else void mark([work.id], true);
              }}
              onMarkHeard={() => void markHeard(work.id)}
              busy={busy}
              childCount={children.get(work.id)}
            />
          ))}
        </div>
      )}
      <nav className="pagination" aria-label="作品分页">
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
      <p className="archive-note">
        已听过状态独立于日期。删除最后一条日期仍保持已听过。编号按体系、主号、子号及补遗分组排序；无法解析的编号稳定排在该体系末尾，未编号排在最后。
      </p>
      {active && (
        <ListeningDialog
          work={{
            ...active,
            source: active.source ?? (active.userCreated ? undefined : composer.source),
          }}
          onClose={() => setActiveId(undefined)}
        />
      )}
      {manual && (
        <ManualWorkDialog composerId={composerId} works={works} onClose={() => setManual(false)} />
      )}
    </section>
  );
}
