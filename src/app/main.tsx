import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('应用挂载节点 #root 不存在。');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // IndexedDB stays usable; offline availability is reported by the shell status.
    window.dispatchEvent(new Event('archive-offline-unavailable'));
  });
}
