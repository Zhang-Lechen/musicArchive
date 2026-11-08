import { useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useArchive } from '../../app/archive-context';
import { downloadBackup, maxBackupBytes, parseBackup, restoreBackup } from '../../services/backup';
import { importCatalog, previewCatalog } from '../../services/catalog';
import { validateCatalog } from '../../services/validation';
import type { Backup, Catalog } from '../../domain/types';

type Candidate =
  | { kind: 'backup'; data: Backup; merged: number }
  | { kind: 'catalog'; data: Catalog; added: number; matched: number };
export function DataManager({ onClose }: { onClose: () => void }) {
  const [candidate, setCandidate] = useState<Candidate>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(0);
  const { notify } = useArchive();
  async function choose(file: File | undefined, kind: Candidate['kind']) {
    if (!file) return;
    const current = ++operation.current;
    setCandidate(undefined);
    setConfirmed(false);
    setError('');
    setBusy(true);
    try {
      if (file.size > maxBackupBytes) throw new Error('文件超过 100 MB。');
      const json = await file.text();
      if (kind === 'backup') {
        const parsed = parseBackup(json);
        if (current === operation.current)
          setCandidate({ kind, data: parsed.backup, merged: parsed.mergedRecords });
      } else {
        const data = validateCatalog(JSON.parse(json));
        const plan = await previewCatalog(data);
        if (current === operation.current)
          setCandidate({ kind, data, added: plan.addedWorks, matched: plan.matchedWorks });
      }
    } catch (error) {
      if (current === operation.current)
        setError(error instanceof Error ? error.message : '文件无法读取。');
    } finally {
      if (current === operation.current) setBusy(false);
    }
  }
  return (
    <Dialog
      title="数据与备份"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p className="muted">
        档案仅保存在当前浏览器。清除站点数据、无痕模式或设备损坏可能导致丢失，请定期导出。
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section className="data-section">
        <h3>导出完整备份</h3>
        <p>UTF-8 JSON，包含目录、别名、听过状态、全部日期、关注、喜欢、待听及来源资料。</p>
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await downloadBackup();
              notify('备份文件已生成。请妥善保存。');
            } catch (error) {
              setError(error instanceof Error ? error.message : '导出失败。');
            } finally {
              setBusy(false);
            }
          }}
        >
          导出 JSON 备份
        </button>
      </section>
      <section className="data-section">
        <h3>从备份恢复</h3>
        <p>先校验和预览，确认后将替换当前本地数据。建议先导出一份当前备份。</p>
        <label className="file-label">
          选择备份 JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              void choose(event.target.files?.[0], 'backup');
              event.target.value = '';
            }}
          />
        </label>
      </section>
      <section className="data-section">
        <h3>更新作品目录</h3>
        <p>
          选择离线管道生成的目录
          JSON。按来源映射更新元数据，保留个人聆听档案。冲突会拒绝导入并提示人工复核。
        </p>
        <label className="file-label">
          选择目录 JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              void choose(event.target.files?.[0], 'catalog');
              event.target.value = '';
            }}
          />
        </label>
      </section>
      {busy && <p role="status">正在校验或保存，请稍候…</p>}
      {candidate && (
        <section className="import-preview" aria-labelledby="import-heading">
          <h3 id="import-heading">
            {candidate.kind === 'backup' ? '备份恢复预览' : '目录更新预览'}
          </h3>
          <p>
            {candidate.data.composers.length} 位作曲家 · {candidate.data.works.length} 条作品
          </p>
          {candidate.kind === 'backup' ? (
            <>
              <p>
                {candidate.data.workProgress.filter((p) => p.isHeard).length} 部已听过 ·{' '}
                {candidate.data.listeningRecords.length} 条日期
              </p>
              <p>
                格式版本 {candidate.data.formatVersion} · 导出于 {candidate.data.exportedAt}
              </p>
              <p>
                {candidate.data.composerPreferences.filter((row) => row.isFollowing).length} 位关注
                · {candidate.data.composerPreferences.filter((row) => row.isFavorite).length}{' '}
                位喜欢的作曲家 ·{' '}
                {candidate.data.workPreferences.filter((row) => row.isFavorite).length} 部喜欢的作品
                · {candidate.data.workPreferences.filter((row) => row.isInQueue).length} 部待听
              </p>
              {candidate.merged > 0 && (
                <p>已合并 {candidate.merged} 条同作品、同精度、同日期的重复记录。</p>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我理解这将替换当前本地数据
              </label>
            </>
          ) : (
            <>
              <p>
                新增 {candidate.added} 条作品，匹配更新 {candidate.matched} 条；个人记录不改变。
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                确认更新目录元数据
              </label>
            </>
          )}
          <div className="button-row">
            <button
              className={candidate.kind === 'backup' ? 'danger-button' : 'primary-button'}
              disabled={!confirmed || busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  if (candidate.kind === 'backup') await restoreBackup(candidate.data);
                  else await importCatalog(candidate.data);
                  notify(
                    candidate.kind === 'backup'
                      ? '备份已恢复，所有页面已更新。'
                      : '作品目录已更新，个人记录已保留。',
                  );
                  onClose();
                } catch (error) {
                  setError(error instanceof Error ? error.message : '写入失败，原数据保留。');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {candidate.kind === 'backup' ? '确认替换本地数据' : '确认更新目录'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setCandidate(undefined);
                setConfirmed(false);
              }}
            >
              取消
            </button>
          </div>
        </section>
      )}
    </Dialog>
  );
}
