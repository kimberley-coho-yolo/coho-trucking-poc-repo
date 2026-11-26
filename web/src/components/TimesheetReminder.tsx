// Reminds a driver about timesheet days not sent: sent back by the supervisor, overdue, or due within a day.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { timesheetReminders, weekday, type Reminder } from '../lib/forms';
import { usePeriodSettings } from '../lib/appSettings';
import { useAccess, useApp } from '../state';
import { todayIso } from './ui';

const nice = (d: string) => `${weekday(d).slice(0, 3)} ${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function TimesheetReminder() {
  const { person } = useApp();
  const can = useAccess();
  const ps = usePeriodSettings();
  const [lines, setLines] = useState<Row[]>([]);
  const alerted = useRef(false);
  const mayUse = !!person && (can.edit('forms') || can.edit('shifts'));
  useEffect(() => {
    if (!mayUse) { setLines([]); return; }
    const load = () => backend().list('timesheet_lines', { person_id: person!.id }).then(setLines).catch(() => null);
    load();
    const stop = backend().watch([{ table: 'timesheet_lines', column: 'person_id', value: person!.id }], () => load());
    const onBack = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onBack);
    return () => { stop(); document.removeEventListener('visibilitychange', onBack); };
  }, [mayUse, person?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = mayUse ? timesheetReminders(lines, todayIso(), ps) : [];
  const urgent = items.filter(i => i.kind !== 'due_soon');
  useEffect(() => {
    if (!urgent.length || alerted.current || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    alerted.current = true;
    try { new Notification('Coho Drive: timesheet not sent', { body: text(urgent[0]), tag: 'coho-timesheet' }); } catch { /* not supported */ }
  }, [urgent.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  const first = items[0];
  return (
    <div className={'outbox-bar ' + (first.kind === 'due_soon' ? 'waiting' : 'fail') + ' ts-reminder'} role={first.kind === 'due_soon' ? 'status' : 'alert'}>
      <span>{text(first)}{items.length > 1 ? ` (+${items.length - 1} more)` : ''}</span>
      <Link className="button small" to={`/forms/timesheet?person=${person!.id}&start=${first.start}`}>{first.kind === 'returned' ? 'Fix and send' : 'Review and send'}</Link>
    </div>
  );
}

function text(r: Reminder) {
  const span = `${nice(r.start)} to ${nice(r.end)}`;
  const days = `${r.days} day${r.days > 1 ? 's' : ''}`;
  if (r.kind === 'returned') return `Your supervisor sent back ${days} of your timesheet (${span}). Fix and send again.`;
  if (r.kind === 'overdue') return `Timesheet ${span} not sent: ${days}. It was due ${r.due.slice(11)} ${nice(r.due.slice(0, 10))}.`;
  return `Timesheet due ${r.due.slice(11)} ${nice(r.due.slice(0, 10))}: ${days} not sent yet.`;
}
