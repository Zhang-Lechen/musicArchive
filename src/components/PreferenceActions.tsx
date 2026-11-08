import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repository } from '../db/repository';

function PreferenceButton({
  active,
  label,
  activeLabel,
  name,
  disabled,
  save,
}: {
  active: boolean;
  label: string;
  activeLabel: string;
  name: string;
  disabled: boolean;
  save: (value: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="preference-control">
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${active ? activeLabel : label} ${name}`}
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await save(!active);
          } catch (error) {
            setError(error instanceof Error ? error.message : '标记保存失败，请重试。');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? '保存中…'
          : active
            ? `✓ ${label === '加入待听' ? '已在待听' : label === '关注' ? '已关注' : '已喜欢'}`
            : label}
      </button>
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ComposerPreferenceActions({
  composerId,
  name,
}: {
  composerId: string;
  name: string;
}) {
  const preference = useLiveQuery(
    async () => (await repository.getComposerPreference(composerId)) ?? null,
    [composerId],
  );
  return (
    <div className="preference-actions" role="group" aria-label={`${name} 的作曲家标记`}>
      <PreferenceButton
        active={preference?.isFollowing ?? false}
        label="关注"
        activeLabel="取消关注"
        name={name}
        disabled={preference === undefined}
        save={(value) => repository.setComposerPreference(composerId, 'isFollowing', value)}
      />
      <PreferenceButton
        active={preference?.isFavorite ?? false}
        label="喜欢作曲家"
        activeLabel="取消喜欢作曲家"
        name={name}
        disabled={preference === undefined}
        save={(value) => repository.setComposerPreference(composerId, 'isFavorite', value)}
      />
    </div>
  );
}

export function WorkPreferenceActions({ workId, name }: { workId: string; name: string }) {
  const preference = useLiveQuery(
    async () => (await repository.getWorkPreference(workId)) ?? null,
    [workId],
  );
  return (
    <div className="preference-actions" role="group" aria-label={`${name} 的作品标记`}>
      <PreferenceButton
        active={preference?.isFavorite ?? false}
        label="喜欢作品"
        activeLabel="取消喜欢作品"
        name={name}
        disabled={preference === undefined}
        save={(value) => repository.setWorkPreference(workId, 'isFavorite', value)}
      />
      <PreferenceButton
        active={preference?.isInQueue ?? false}
        label="加入待听"
        activeLabel="移出待听"
        name={name}
        disabled={preference === undefined}
        save={(value) => repository.setWorkPreference(workId, 'isInQueue', value)}
      />
    </div>
  );
}
