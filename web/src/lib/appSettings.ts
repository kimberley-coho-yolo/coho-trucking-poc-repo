// App-wide settings that admin changes in Settings (app_settings table), e.g. the timesheet start day.
import { useEffect, useState } from 'react';
import { backend, type Row } from './backend';
import { DEFAULT_PERIOD, type PeriodSettings, type PeriodView } from './forms';

let cache: Promise<Row[]> | null = null;
const listeners = new Set<() => void>();
export function reloadAppSettings() { cache = null; for (const l of listeners) l(); }

export function periodSettingsFrom(rows: Row[]): PeriodSettings {
  const v = (id: string) => rows.find(r => r.id === id)?.value;
  const ws = Number(v('timesheet_week_start'));
  const view = v('timesheet_default_view');
  const anchor = v('timesheet_cycle_anchor');
  return {
    weekStart: Number.isInteger(ws) && ws >= 0 && ws <= 6 ? ws : DEFAULT_PERIOD.weekStart,
    view: view === 'week' || view === 'fortnight' ? (view as PeriodView) : DEFAULT_PERIOD.view,
    anchor: typeof anchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? anchor : DEFAULT_PERIOD.anchor,
  };
}

/** Timesheet period settings (start day, default view), loaded once and shared. */
export function usePeriodSettings(): PeriodSettings {
  const [s, setS] = useState<PeriodSettings>(DEFAULT_PERIOD);
  useEffect(() => {
    let live = true;
    const load = () => (cache ??= backend().list('app_settings').catch(() => [])).then(rows => { if (live) setS(periodSettingsFrom(rows)); });
    load(); listeners.add(load);
    return () => { live = false; listeners.delete(load); };
  }, []);
  return s;
}
