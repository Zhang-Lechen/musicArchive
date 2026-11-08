import { createContext, useContext } from 'react';
import type { UndoToken } from '../db/repository';

export type Notice = { message: string; undo?: UndoToken };
export const ArchiveContext = createContext<{
  ready: boolean;
  notify: (message: string, undo?: UndoToken) => void;
  notice?: Notice;
  undoing: boolean;
  undoNotice: () => Promise<void>;
  dismissNotice: () => void;
}>({
  ready: false,
  notify: () => undefined,
  undoing: false,
  undoNotice: async () => undefined,
  dismissNotice: () => undefined,
});
export function useArchive() {
  return useContext(ArchiveContext);
}
