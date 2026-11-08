import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DataManager } from '../features/composers/DataManager';
import { OfflineStatus } from '../components/OfflineStatus';

export function AppLayout() {
  const [dataOpen, setDataOpen] = useState(false);
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const searchInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const pendingSearch = useRef<string | undefined>(undefined);
  useEffect(() => {
    pendingSearch.current = undefined;
    const input = searchInput.current;
    if (input && !composing.current && input.value !== query) input.value = query;
  }, [query, location.key]);
  const search = (value: string) => {
    const target = value ? `/?q=${encodeURIComponent(value)}` : '/';
    if (pendingSearch.current === target || `${location.pathname}${location.search}` === target)
      return;
    pendingSearch.current = target;
    void navigate(target);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="app-header">
        <Link className="brand" to="/" aria-label="古典音乐聆听档案首页">
          <span className="brand-mark" aria-hidden="true">
            𝄞
          </span>
          <span>
            <span className="brand-title">古典音乐聆听档案</span>
            <span className="brand-subtitle" lang="en">
              Classical Listening Archive
            </span>
          </span>
        </Link>
        <form
          className="global-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (composing.current) return;
            search(String(new FormData(event.currentTarget).get('composer') ?? ''));
          }}
        >
          <label className="sr-only" htmlFor="composer-search">
            搜索作曲家
          </label>
          <input
            id="composer-search"
            ref={searchInput}
            name="composer"
            type="search"
            placeholder="搜索作曲家，中文或原文名"
            defaultValue={query}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              search(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (composing.current ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229)
              )
                event.preventDefault();
            }}
            onChange={(event) => {
              const native = event.nativeEvent;
              if (!composing.current && !('isComposing' in native && native.isComposing === true))
                search(event.currentTarget.value);
            }}
          />
          <button type="submit" aria-label="搜索作曲家">
            搜索
          </button>
        </form>
        <nav aria-label="档案工具">
          <button className="data-button" onClick={() => setDataOpen(true)}>
            数据与备份
          </button>
        </nav>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <nav className="primary-tabs" aria-label="主导航">
          <NavLink to={location.pathname === '/' ? '/' : '/composers'}>作曲家</NavLink>
          <NavLink to="/favorites">我的收藏</NavLink>
          <NavLink to="/statistics">聆听统计</NavLink>
        </nav>
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>一部作品，一份聆听记忆。</span>
        <OfflineStatus />
      </footer>
      {dataOpen && <DataManager onClose={() => setDataOpen(false)} />}
    </div>
  );
}
