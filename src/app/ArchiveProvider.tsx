import { useEffect, useState, type ReactNode } from 'react';
import { initializeArchive } from '../services/catalog';
import { repository } from '../db/repository';
import { ArchiveContext, type Notice } from './archive-context';
import { NoticeBar } from '../components/NoticeBar';

export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<Notice>();
  const [undoing, setUndoing] = useState(false);
  async function undoNotice() {
    if (!notice?.undo || undoing) return;
    setUndoing(true);
    try {
      await repository.undo(notice.undo);
      setNotice({ message: '已撤销，之前的记录已恢复。' });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : '撤销失败，请重试。' });
    } finally {
      setUndoing(false);
    }
  }
  useEffect(() => {
    let active = true;
    initializeArchive()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : '无法访问本地数据库。');
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <ArchiveContext.Provider
      value={{
        ready,
        notify: (message, undo) => setNotice({ message, undo }),
        notice,
        undoing,
        undoNotice,
        dismissNotice: () => setNotice(undefined),
      }}
    >
      {error ? (
        <div className="error-panel" role="alert">
          <h1>本地档案暂时无法打开</h1>
          <p>{error}</p>
          <p>请确认浏览器允许此站点使用 IndexedDB，且磁盘空间充足。不要清除站点数据。</p>
          <button
            onClick={() => {
              setError('');
              setAttempt(attempt + 1);
            }}
          >
            重新尝试
          </button>
        </div>
      ) : !ready ? (
        <div className="loading-panel" role="status">
          正在准备本地作品目录，首次启动可能需要几秒…
        </div>
      ) : (
        children
      )}
      <NoticeBar />
    </ArchiveContext.Provider>
  );
}
