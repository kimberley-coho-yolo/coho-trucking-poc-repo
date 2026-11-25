import { createContext, useContext } from 'react';
import type { Role, Row, Session } from './lib/backend';
import { best, canEdit, canRead, type Access, type Perms } from './lib/permissions';

export interface AppState {
  session: Session | null;
  role: Role | null;
  perms: Perms;                       // hidden / read / edit per function, from Settings
  person: Row | null;                 // who is driving (picked after sign-in on a work phone)
  setPerson: (p: Row | null) => void;
  refresh: () => Promise<void>;
}
export const AppCtx = createContext<AppState>(null as any);
export const useApp = () => useContext(AppCtx);

/** Access helpers for the signed-in user. */
export function useAccess() {
  const { perms } = useApp();
  return {
    perms,
    read: (f: string) => canRead(perms, f),
    edit: (f: string) => canEdit(perms, f),
    level: (...f: string[]): Access => best(perms, ...f),
  };
}

// Kept for older code paths: "staff" = can see all crews' work, "office" = can edit people lists.
export const isStaff = (p: Perms) => canRead(p, 'all_work');
export const isOffice = (p: Perms) => canEdit(p, 'people');
