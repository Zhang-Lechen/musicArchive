import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { account, signIn, signOut, cloudCall, syncConfigured } from '../../sync/client';
import {
  bindAccount,
  previewSync,
  resolveConflict,
  synchronize,
  retryUnresolved,
} from '../../sync/engine';
import { payloadSchema, type Payload } from '../../sync/protocol';
import type { SyncEntity } from '../../sync/types';

function Conflict({
  row,
  run,
}: {
  row: SyncEntity;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Payload>();
  return (
    <article className="sync-conflict">
      <h4>{row.desired?.title ?? row.conflict?.payload?.title ?? row.key}</h4>
      <p>
        同一字段、日期或删除发生并发修改。云端时间：{row.conflict?.updatedAt}；设备：
        {row.conflict?.deviceId}
      </p>
      <details>
        <summary>比较本地与云端内容</summary>
        <p>本地</p>
        <pre>{JSON.stringify(row.desired, null, 2)}</pre>
        <p>云端</p>
        <pre>{JSON.stringify(row.conflict?.payload, null, 2)}</pre>
      </details>
      <div className="button-row">
        <button onClick={() => void run(() => resolveConflict(db, row.key, 'local'))}>
          保留本地
        </button>
        <button onClick={() => void run(() => resolveConflict(db, row.key, 'remote'))}>
          保留云端
        </button>
        <button
          onClick={() => {
            setDraft(structuredClone(row.desired ?? row.conflict?.payload ?? undefined));
            setEditing(true);
          }}
        >
          手动编辑
        </button>
      </div>
      {editing && draft && (
        <div className="sync-editor">
          {draft.kind === 'work' && (
            <label>
              聆听状态
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as Payload['status'] })
                }
              >
                <option value="unheard">未听过</option>
                <option value="partial">部分听过</option>
                <option value="completed">完整听过</option>
              </select>
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={draft.favorite}
              onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })}
            />
            喜欢
          </label>
          {draft.kind === 'composer' ? (
            <label>
              <input
                type="checkbox"
                checked={draft.following}
                onChange={(e) => setDraft({ ...draft, following: e.target.checked })}
              />
              关注
            </label>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={draft.queued}
                  onChange={(e) => setDraft({ ...draft, queued: e.target.checked })}
                />
                待听
              </label>
              <p>完整聆听日期；改为未听过或部分听过前，请逐条确认删除日期。</p>
              {Object.entries(draft.records).map(([id, record]) => (
                <div key={id}>
                  <label>
                    日期精度
                    <select
                      value={record.datePrecision}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          records: {
                            ...draft.records,
                            [id]: {
                              ...record,
                              datePrecision: e.target.value as typeof record.datePrecision,
                              dateValue: e.target.value === 'unknown' ? null : '',
                              updatedAt: new Date().toISOString(),
                            },
                          },
                        })
                      }
                    >
                      <option value="day">日</option>
                      <option value="month">月</option>
                      <option value="year">年</option>
                      <option value="unknown">日期不详</option>
                    </select>
                  </label>
                  {record.datePrecision !== 'unknown' && (
                    <label>
                      聆听日期
                      <input
                        placeholder="例如 2020-06-15、2020-06 或 2020"
                        value={record.dateValue ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            records: {
                              ...draft.records,
                              [id]: {
                                ...record,
                                dateValue: e.target.value,
                                updatedAt: new Date().toISOString(),
                              },
                            },
                          })
                        }
                      />
                    </label>
                  )}
                  <button
                    onClick={() => {
                      const records = { ...draft.records };
                      delete records[id];
                      setDraft({ ...draft, records });
                    }}
                  >
                    删除此日期
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    records: {
                      ...draft.records,
                      [crypto.randomUUID()]: {
                        datePrecision: 'year',
                        dateValue: '',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                      },
                    },
                  })
                }
              >
                添加日期
              </button>
            </>
          )}
          <button
            onClick={() =>
              void run(async () => {
                const result = payloadSchema.safeParse(draft);
                if (!result.success) throw new Error('请检查日期格式、重复日期以及聆听状态。');
                await resolveConflict(db, row.key, result.data);
                setEditing(false);
              })
            }
          >
            保存解决结果
          </button>
        </div>
      )}
    </article>
  );
}
export function SyncPanel() {
  const [user, setUser] = useState<{ uid: string; email: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewSync>>>();
  const rows = useLiveQuery(() => db.sync_entities.toArray(), []) ?? [];
  const owner = useLiveQuery(() => db.sync_meta.get('owner'), []);
  const last = useLiveQuery(() => db.sync_meta.get('last-result'), []);
  const savedBackup = useLiveQuery(() => db.sync_meta.get('before-first-sync'), []);
  useEffect(() => {
    let active = true;
    if (syncConfigured)
      void account()
        .then((value) => {
          if (active) setUser(value);
        })
        .catch(() => {
          if (active) setError('无法恢复登录，请检查网络或重新登录。');
        });
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      active = false;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : '操作失败。'} 本地数据仍保留。`);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (!user) return;
    const result = await synchronize(db, user.uid, (request) => cloudCall(request, user.uid));
    setMessage(
      `已上传 ${result.uploaded} 项，下载 ${result.downloaded} 项；待上传 ${result.pending} 项，冲突 ${result.conflicts} 项，待匹配 ${result.unresolved} 项。`,
    );
  }
  const lastTime = (last?.value as { time?: string } | undefined)?.time;
  const conflicts = rows.filter((row) => row.conflict);
  const unresolved = rows.filter((row) => row.unresolved);
  const mismatch = Boolean(owner && user && owner.value !== user.uid);
  return (
    <section className="data-section sync-panel" aria-label="云同步">
      <h3>云同步</h3>
      <p>
        状态：
        {!syncConfigured
          ? '未配置'
          : !online
            ? '离线'
            : busy
              ? '处理中'
              : !user
                ? '未登录'
                : conflicts.length
                  ? '存在冲突'
                  : unresolved.length
                    ? '待匹配目录'
                    : rows.some((row) => row.dirty)
                      ? '存在待同步修改'
                      : lastTime
                        ? '已同步'
                        : '尚未同步'}
      </p>
      {!syncConfigured ? (
        <p>部署 CloudBase 同步服务后，配置环境 ID 和同步接口地址，即可在不同浏览器之间同步。</p>
      ) : (
        <fieldset disabled={busy}>
          {!user ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  try {
                    setUser(await signIn(email, password));
                  } finally {
                    setPassword('');
                  }
                });
              }}
            >
              <label>
                邮箱
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button type="submit" className="primary-button">
                登录
              </button>
            </form>
          ) : (
            <>
              <p>账户：{user.email}</p>
              <p>
                待上传：{rows.filter((row) => row.dirty).length} 项；上次完成同步检查：
                {lastTime ? new Date(lastTime).toLocaleString() : '尚无'}
              </p>
              {mismatch ? (
                <p role="alert">
                  此本地档案已绑定其他账户。请退出并登录原账户，或使用独立浏览器配置文件。当前账户不能同步此档案。
                </p>
              ) : owner ? (
                <button
                  className="primary-button"
                  disabled={!online}
                  onClick={() => void run(sync)}
                >
                  立即同步
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={!online}
                  onClick={() =>
                    void run(async () => {
                      setPreview(await previewSync(db, (request) => cloudCall(request, user.uid)));
                    })
                  }
                >
                  检查首次同步
                </button>
              )}
              <button
                onClick={() =>
                  void run(async () => {
                    await signOut();
                    setUser(null);
                    setPreview(undefined);
                  })
                }
              >
                退出登录
              </button>
              {preview && !owner && (
                <div className="import-preview">
                  <p>
                    预计上传 {preview.upload} 项、云端已有 {preview.download} 项、预估冲突{' '}
                    {preview.conflicts} 项。同步时会重新检查版本。
                  </p>
                  <p>
                    确认后将此档案绑定当前账户，并先保存完整本地备份。云端空档案不会删除本地记录。
                  </p>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await bindAccount(db, user.uid);
                        setPreview(undefined);
                        await sync();
                      })
                    }
                  >
                    保存备份并确认首次同步
                  </button>
                  <button onClick={() => setPreview(undefined)}>取消</button>
                </div>
              )}
              {!mismatch && conflicts.map((row) => <Conflict key={row.key} row={row} run={run} />)}
              {conflicts.length > 0 && (
                <p>保存解决结果后，请点击“立即同步”提交；若云端再次改变，会重新提示冲突。</p>
              )}
              {unresolved.length > 0 && (
                <div>
                  <p>
                    有 {unresolved.length}{' '}
                    项未匹配到本地目录，原始个人数据已保留。手动补录作品可先导入来源设备的完整备份，公共作品请更新目录。
                  </p>
                  <button onClick={() => void run(() => retryUnresolved(db))}>重新匹配目录</button>
                  <details>
                    <summary>待匹配记录</summary>
                    {unresolved.map((row) => (
                      <p key={row.key}>{row.desired?.title ?? row.key}</p>
                    ))}
                  </details>
                </div>
              )}
            </>
          )}
        </fieldset>
      )}
      {savedBackup && (
        <button
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(savedBackup.value, null, 2)], { type: 'application/json' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = 'before-first-sync.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          下载首次同步前备份
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
