import { useArchive } from '../app/archive-context';

export function NoticeBar({ inline = false }: { inline?: boolean }) {
  const { notice, undoing, undoNotice, dismissNotice } = useArchive();
  if (!notice) return null;
  return (
    <div className={inline ? 'inline-notice' : 'toast'} role="status">
      <span>{notice.message}</span>
      {notice.undo && (
        <button disabled={undoing} onClick={() => void undoNotice()}>
          撤销
        </button>
      )}
      <button className="icon-button" aria-label="关闭提示" onClick={dismissNotice}>
        ×
      </button>
    </div>
  );
}
