import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { repository } from '../../db/repository';
import { compareWorks, composerMatches, workMatches } from '../../domain/catalog';
import type { WorkView } from '../../domain/types';
import { ComposerCard } from '../../components/ComposerCard';
import { WorkCard } from '../../components/WorkCard';
import { useDebounced } from '../../components/use-debounced';
import { ListeningDialog } from '../listening/ListeningDialog';
import { useArchive } from '../../app/archive-context';

const sections = [
  { key: 'following', label: '关注的作曲家' },
  { key: 'composers', label: '喜欢的作曲家' },
  { key: 'works', label: '喜欢的作品' },
  { key: 'queue', label: '待听清单' },
];

export function PreferencesPage() {
  const [params] = useSearchParams();
  const section = sections.find((item) => item.key === params.get('section')) ?? sections[0]!;
  const composers = useLiveQuery(() => repository.preferredComposers(), []);
  const works = useLiveQuery(() => repository.preferredWorks(), []);
  const [query, setQuery] = useState('');
  const search = useDebounced(query);
  const [cursor, setCursor] = useState({ key: '', page: 1 });
  const [active, setActive] = useState<WorkView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notify } = useArchive();
  const composerSection = section.key === 'following' || section.key === 'composers';
  const filteredComposers = useMemo(
    () =>
      (composers ?? [])
        .filter(
          (composer) =>
            (section.key === 'following'
              ? composer.preference.isFollowing
              : composer.preference.isFavorite) && composerMatches(composer, search),
        )
        .sort((a, b) => a.nameOriginal.localeCompare(b.nameOriginal) || a.id.localeCompare(b.id)),
    [composers, search, section.key],
  );
  const filteredWorks = useMemo(
    () =>
      (works ?? [])
        .filter(
          (work) =>
            (section.key === 'queue' ? work.preference.isInQueue : work.preference.isFavorite) &&
            (workMatches(work, search) || composerMatches(work.composer, search)),
        )
        .sort(
          (a, b) =>
            a.composer.nameOriginal.localeCompare(b.composer.nameOriginal) ||
            a.composerId.localeCompare(b.composerId) ||
            compareWorks(a, b),
        ),
    [works, search, section.key],
  );
  const counts = {
    following: composers?.filter((row) => row.preference.isFollowing).length ?? 0,
    composers: composers?.filter((row) => row.preference.isFavorite).length ?? 0,
    works: works?.filter((row) => row.preference.isFavorite).length ?? 0,
    queue: works?.filter((row) => row.preference.isInQueue).length ?? 0,
  };
  const total = composerSection ? filteredComposers.length : filteredWorks.length;
  const pageSize = composerSection ? 24 : 36;
  const key = JSON.stringify([section.key, search]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(cursor.key === key ? cursor.page : 1, pages);
  const start = (page - 1) * pageSize;
  const ready = composers !== undefined && works !== undefined;
  const open = (work: NonNullable<typeof works>[number]) =>
    setActive({
      ...work,
      source: work.source ?? (work.userCreated ? undefined : work.composer.source),
    });
  async function listen(work: NonNullable<typeof works>[number], unknownDate = false) {
    if (work.progress?.isHeard && !unknownDate) {
      open(work);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const token = unknownDate
        ? await repository.setStatus(work.id, 'completed', {
            completedDate: { datePrecision: 'unknown', dateValue: null },
          })
        : await repository.setHeard([work.id], true);
      notify(
        unknownDate ? '已标记听过，日期不详。' : '已记录聆听，日期为今天。待听标记保持不变。',
        token,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : '聆听记录保存失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="preferences-title">
      <p className="eyebrow">你的个人清单</p>
      <h1 id="preferences-title">我的收藏</h1>
      <p className="page-intro">
        关注、喜欢和待听各自独立。完整听过后，作品仍会保留在待听清单中，直到你手动移出。
      </p>
      <nav className="preference-sections" aria-label="收藏分类">
        {sections.map((item) => (
          <Link
            key={item.key}
            to={`?section=${item.key}`}
            aria-current={section.key === item.key ? 'page' : undefined}
          >
            {item.label}（{counts[item.key as keyof typeof counts]}）
          </Link>
        ))}
      </nav>
      <div className="toolbar">
        <label className="collection-search">
          搜索收藏与待听
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="作曲家、作品名称、别名或编号"
          />
        </label>
        <p className="muted" role="status">
          {section.label} · {total} 条匹配
        </p>
        {query && <button onClick={() => setQuery('')}>清除清单搜索</button>}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!ready ? (
        <p role="status">正在读取个人清单…</p>
      ) : total === 0 ? (
        <div className="empty-state">
          <h2>{query ? '没有匹配的收藏或待听项' : '这份清单还没有内容'}</h2>
          <p>
            {query
              ? '尝试作曲家、作品名称、别名或编号，或清除搜索。'
              : '在作曲家卡片、作品卡片或详情中添加个人标记，即可在这里查看。'}
          </p>
          <Link to="/">浏览作曲家目录</Link>
        </div>
      ) : composerSection ? (
        <div className="composer-grid">
          {filteredComposers.slice(start, start + pageSize).map((composer, index) => (
            <ComposerCard key={composer.id} composer={composer} index={start + index + 1} />
          ))}
        </div>
      ) : (
        <div className="work-list">
          {filteredWorks.slice(start, start + pageSize).map((work) => (
            <div className="collection-work" key={work.id}>
              <Link className="collection-composer" to={`/composers/${work.composerId}`}>
                {work.composer.nameZh ?? work.composer.nameOriginal}
              </Link>
              <WorkCard
                work={work}
                onOpen={() => open(work)}
                onListen={() => void listen(work)}
                onMarkHeard={() => void listen(work, true)}
                busy={busy}
              />
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <nav className="pagination" aria-label="收藏分页">
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
      {active && <ListeningDialog work={active} onClose={() => setActive(undefined)} />}
    </section>
  );
}
