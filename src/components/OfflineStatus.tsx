import { useEffect, useState } from 'react';

export function OfflineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => setOnline(navigator.onLine);
    const failed = () => setUnavailable(true);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('archive-offline-unavailable', failed);
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.ready.then(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('archive-offline-unavailable', failed);
    };
  }, []);
  return (
    <span role="status">
      {!online
        ? '当前离线 · 档案仍保存在本机'
        : unavailable
          ? '本机保存 · 离线缓存未就绪'
          : ready
            ? '离线已就绪 · 请定期导出备份'
            : '本地优先 · 请定期导出备份'}
    </span>
  );
}
