import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dialog } from '../../components/Dialog';
import { WorkPreferenceActions } from '../../components/PreferenceActions';
import { repository } from '../../db/repository';
import { useArchive } from '../../app/archive-context';
import { formatDate, localToday, validateDate } from '../../domain/dates';
import { primaryIdentifier } from '../../domain/catalog';
import {
  isCountable,
  type DatePrecision,
  type ListeningRecord,
  type WorkView,
} from '../../domain/types';

export function ListeningDialog({ work, onClose }: { work: WorkView; onClose: () => void }) {
  const snapshot = useLiveQuery(() => repository.getSnapshot(work.id), [work.id]);
  const [precision, setPrecision] = useState<DatePrecision>('day');
  const [value, setValue] = useState(localToday());
  const [editing, setEditing] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useArchive();
  const playable = isCountable(work);
  const close = () => {
    if (!busy && (!dirty || window.confirm('还有未保存的日期修改，确定放弃吗？'))) onClose();
  };
  const records = [...(snapshot?.records ?? [])].sort(
    (a, b) => (b.dateValue ?? '').localeCompare(a.dateValue ?? '') || a.id.localeCompare(b.id),
  );
  async function run(
    action: () => Promise<import('../../db/repository').UndoToken>,
    message: string,
  ) {
    setBusy(true);
    setError('');
    try {
      const token = await action();
      notify(message, token);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，现有记录未改变。');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(record: ListeningRecord) {
    if (dirty && !window.confirm('放弃当前尚未保存的日期修改吗？')) return;
    setEditing(record.id);
    setPrecision(record.datePrecision);
    setValue(record.dateValue ?? '');
    setDirty(false);
    setError('');
  }
  return (
    <Dialog
      title={`${primaryIdentifier(work)?.value ?? '未编号'} · ${work.titleZh ?? work.titleOriginal}`}
      onClose={close}
      wide
    >
      <p className="dialog-subtitle">{work.titleOriginal}</p>
      <WorkPreferenceActions
        workId={work.id}
        name={primaryIdentifier(work)?.value ?? work.titleZh ?? work.titleOriginal}
      />
      {!playable && (
        <p className="coverage-banner">
          此条目不独立统计聆听进度，作品集和乐章不自动推断听过状态。
        </p>
      )}
      <div className="status-row">
        <span className={`badge ${snapshot?.progress?.isHeard ? 'badge-heard' : ''}`}>
          {snapshot?.progress?.isHeard ? '✓ 已听过' : '○ 未听过'}
        </span>
        <span className="muted" aria-label="日期记录状态">
          {snapshot?.progress?.isHeard && !records.length ? '日期不详' : `${records.length} 条日期`}
        </span>
      </div>
      {!!work.identifiers.length && (
        <p className="muted small">
          编号：
          {work.identifiers
            .map((i) => `${i.value}${i.edition ? `（${i.edition}）` : ''}`)
            .join(' · ')}
        </p>
      )}
      {!!work.aliases.length && (
        <p className="muted small">别名：{work.aliases.map((a) => a.text).join(' · ')}</p>
      )}
      {work.source && (
        <p className="muted small">
          来源：
          <a href={work.source.url} target="_blank" rel="noreferrer">
            {work.source.name}
          </a>{' '}
          · {work.source.catalogEdition ?? '版次未注明'} · {work.source.license}
        </p>
      )}
      {work.userCreated && !work.source && (
        <p className="muted small">来源：手动补录，保留个人填写的作品名称。</p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <section className="record-section" aria-labelledby="history-heading">
        <h3 id="history-heading">聆听历史</h3>
        {!records.length ? (
          <p className="muted">暂无日期记录；已听过状态可独立保存。</p>
        ) : (
          <ul className="record-list">
            {records.map((record) => (
              <li key={record.id}>
                <time dateTime={record.dateValue ?? undefined}>
                  {formatDate(record.datePrecision, record.dateValue)}
                </time>
                <div className="button-row">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => edit(record)}
                    aria-label={`编辑 ${formatDate(record.datePrecision, record.dateValue)}`}
                  >
                    编辑
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('删除这条日期？已听过状态会保留，删除后可以撤销。'))
                        void run(
                          () => repository.deleteRecord(work.id, record.id),
                          '日期已删除，已听过状态保留。',
                        );
                    }}
                    aria-label={`删除 ${formatDate(record.datePrecision, record.dateValue)}`}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {playable && (
        <form
          className="record-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              validateDate(precision, precision === 'unknown' ? null : value);
            } catch (error) {
              setError(error instanceof Error ? error.message : '日期无效');
              return;
            }
            if (
              await run(
                () =>
                  repository.saveRecord(
                    work.id,
                    precision,
                    precision === 'unknown' ? null : value,
                    editing,
                  ),
                editing ? '日期已修改。' : '已添加聆听日期。',
              )
            ) {
              setDirty(false);
              setEditing(undefined);
              setPrecision('day');
              setValue(localToday());
            }
          }}
        >
          <h3>{editing ? '编辑日期' : '添加日期'}</h3>
          <div className="form-grid">
            <label>
              日期精度
              <select
                value={precision}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as DatePrecision;
                  setPrecision(next);
                  setValue(
                    next === 'year'
                      ? localToday().slice(0, 4)
                      : next === 'month'
                        ? localToday().slice(0, 7)
                        : next === 'unknown'
                          ? ''
                          : localToday(),
                  );
                  setDirty(true);
                }}
              >
                <option value="day">年月日</option>
                <option value="month">年月</option>
                <option value="year">年份</option>
                <option value="unknown">日期不详</option>
              </select>
            </label>
            {precision !== 'unknown' && (
              <label>
                聆听日期
                <input
                  aria-describedby="date-help"
                  required
                  type={precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'text'}
                  inputMode={precision === 'year' ? 'numeric' : undefined}
                  placeholder={precision === 'year' ? '2019' : undefined}
                  max={
                    precision === 'day'
                      ? localToday()
                      : precision === 'month'
                        ? localToday().slice(0, 7)
                        : undefined
                  }
                  value={value}
                  disabled={busy}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            )}
          </div>
          <p id="date-help" className="muted small">
            可补录历史日期。仅知道年份时选择“年份”，不会自动补成 1 月 1 日。
          </p>
          <div className="button-row">
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? '保存中…' : editing ? '保存修改' : '添加日期'}
            </button>
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(undefined);
                  setDirty(false);
                  setPrecision('day');
                  setValue(localToday());
                }}
              >
                取消编辑
              </button>
            )}
          </div>
        </form>
      )}
      {playable && (
        <div className="dialog-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  repository.setStatus(work.id, 'completed', {
                    completedDate: { datePrecision: 'unknown', dateValue: null },
                  }),
                '已标记听过，日期不详。',
              )
            }
          >
            标记已听过（日期不详）
          </button>
          <button
            className="danger"
            disabled={busy || !snapshot?.progress?.isHeard}
            onClick={async () => {
              if (window.confirm('恢复未听过将清空此作品的全部聆听日期。确定继续吗？')) {
                if (
                  await run(
                    () => repository.resetUnheard(work.id, { confirmClearHistory: true }),
                    '已恢复未听过，全部日期已清空。',
                  )
                ) {
                  setEditing(undefined);
                  setDirty(false);
                }
              }
            }}
          >
            恢复未听过
          </button>
        </div>
      )}
    </Dialog>
  );
}
