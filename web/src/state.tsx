import { createContext, useContext } from 'react';
import type { Role, Row, Session } from './lib/backend';

export interface AppState {
  session: Session | null;
  role: Role | null;
  person: Row | null;                 // who is driving (picked after sign-in on a work phone)
  setPerson: (p: Row | null) => void;
  refresh: () => Promise<void>;
}
export const AppCtx = createContext<AppState>(null as any);
export const useApp = () => useContext(AppCtx);

export const isStaff = (r: Role | null) => r === 'admin' || r === 'office' || r === 'supervisor';
export const isOffice = (r: Role | null) => r === 'admin' || r === 'office';
