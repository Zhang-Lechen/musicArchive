import type { Payload, Remote, Operation } from './protocol';
export type SyncEntity = {
  key: string;
  localId?: string;
  kind: 'work' | 'composer';
  revision: string;
  base: Payload | null;
  desired: Payload | null;
  dirty: number;
  conflict?: Remote;
  unresolved?: Remote;
};
export type SyncMeta = { key: string; value: unknown };
export type PendingOperation = Operation & { submitted: Payload | null };
