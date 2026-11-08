import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { repository } from '../../db/repository';
import { useArchive } from '../../app/archive-context';
import type { Work, WorkView } from '../../domain/types';

export function ManualWorkDialog({
  composerId,
  works,
  onClose,
}: {
  composerId: string;
  works: WorkView[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [titleZh, setTitleZh] = useState('');
  const [system, setSystem] = useState(
    () => works.flatMap((w) => w.identifiers).find((i) => i.isPrimary)?.system ?? 'Op',
  );
  const [number, setNumber] = useState('');
  const [secondary, setSecondary] = useState('');
  const [secondarySystem, setSecondarySystem] = useState('Op');
  const [aliases, setAliases] = useState('');
  const [status, setStatus] = useState<Work['catalogStatus']>('confirmed');
  const [kind, setKind] = useState<Work['kind']>('work');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notify } = useArchive();
  const dirty = Boolean(title || titleZh || number || secondary || aliases || parent);
  return (
    <Dialog
      title="手动补录作品"
      onClose={() => {
        if (!busy && (!dirty || window.confirm('放弃尚未保存的作品信息吗？'))) onClose();
      }}
      wide
    >
      <p className="muted">
        请先搜索已有目录。作品名称或编号更新后，个人记录仍会保留。未来导入同编号作品时会提示关联；无可靠编号时可留空。
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (kind === 'movement' && !parent) throw new Error('乐章必须选择上级作品。');
            const identifiers = [
              { system, value: number },
              { system: secondarySystem, value: secondary },
            ].filter((i) => i.value.trim());
            await repository.addManualWork(
              {
                composerId,
                titleOriginal: title.trim(),
                titleZh: titleZh.trim() || undefined,
                catalogStatus: status,
                kind,
                parentWorkId: parent || undefined,
              },
              identifiers,
              aliases.split(/[\n；;]/),
            );
            notify('作品已补录，目录完整性仍待验证。');
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : '补录失败。');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          原文或可读作品名称
          <input
            required
            maxLength={2000}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          中文名称（可选）
          <input
            maxLength={2000}
            value={titleZh}
            onChange={(e) => setTitleZh(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="form-grid">
          <label>
            主编号体系
            <input
              required
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            完整主编号（可选）
            <input
              placeholder="例如 K. 551"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            别号体系
            <input
              value={secondarySystem}
              onChange={(e) => setSecondarySystem(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            完整别号（可选）
            <input
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <label>
          别名（分号或换行分隔）
          <textarea value={aliases} onChange={(e) => setAliases(e.target.value)} disabled={busy} />
        </label>
        <div className="form-grid">
          <label>
            目录状态
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Work['catalogStatus'])}
            >
              <option value="confirmed">确认归属</option>
              <option value="doubtful">归属存疑</option>
              <option value="fragment">片段 / 未完成</option>
              <option value="lost">佚失，不计进度</option>
            </select>
          </label>
          <label>
            条目层级
            <select value={kind} onChange={(e) => setKind(e.target.value as Work['kind'])}>
              <option value="work">作品</option>
              <option value="collection">作品集</option>
              <option value="movement">乐章</option>
            </select>
          </label>
        </div>
        <label>
          上级作品（可选，子作品不单独统计）
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">无，作为主作品</option>
            {works
              .filter((w) => !w.parentWorkId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.titleZh ?? w.titleOriginal}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" disabled={busy} className="primary-button">
          {busy ? '保存中…' : '保存作品'}
        </button>
      </form>
    </Dialog>
  );
}
